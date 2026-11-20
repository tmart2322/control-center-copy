'use client';
/**
 * Time ▸ Forecast building blocks shared by the view and the details panel (lane A): money and age labels, the state
 * badges (color is state only: overdue, due, ready, AI, landed, didn't land; never per account), the actions, and the
 * note editor (draft → edit → approve; staged, handed off and landed show where the note is).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ForecastPayload, ForecastRow, PatchForecastRequest } from '@/contract';
import { api, type ApiError } from '@/client/api';
import { toast } from '@/client/toast';
import { useDetails } from '@/components/deals/context-frame';
import { StatusBadge } from '@/components/domain';
import { Button, cn, Icon } from '@/ui';
import { CopyPromptButton, OpenResult } from '@/components/domain/ResultLinks';
import { forecastCanvasPrompt } from '@/lib/canvas/prompt';
import { errorText } from '@/lib/error-text';

export const usd = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
export const ageLabel = (r: Pick<ForecastRow, 'notesAgeDays' | 'notesUpdatedAt'>) => (r.notesAgeDays === null ? 'never' : r.notesAgeDays === 0 ? 'today' : `${r.notesAgeDays} d`);
/** "05 - Negotiating $$ & Mutual Plan" → "05 Negotiating $$ & Mutual Plan" (decoded). */
export const stageLabel = (s: string | null) => (s ? s.replace(/&amp;/g, '&').replace(/^(\d{2})\s*-\s*/, '$1 ') : '—');

export function NotesAgeBadge({ row, dueLabel }: { row: ForecastRow; dueLabel: string }) {
  if (row.notesState === 'overdue')
    return (
      <StatusBadge tone="danger" icon="warning" title={`Notes ${ageLabel(row)} old: missed the last deadline`}>
        {`Overdue · ${ageLabel(row)}`}
      </StatusBadge>
    );
  if (row.notesState === 'due')
    return (
      <StatusBadge tone="warning" icon="clock" title={`Notes ${ageLabel(row)} old: fresh notes due ${dueLabel}`}>
        {`Due ${dueLabel} · ${ageLabel(row)}`}
      </StatusBadge>
    );
  return <span className="text-caption text-muted tabular-nums">{ageLabel(row)}</span>;
}

/** Where a note or Deal Role update is. */
export function UpdateBadge({ state, origin }: { state: ForecastRow['notes']['state']; origin?: ForecastRow['notes']['origin'] }) {
  switch (state) {
    case 'drafting':
      return <StatusBadge tone="ai" icon="sparkle">Drafting…</StatusBadge>;
    case 'drafted':
      return origin === 'model' ? <StatusBadge tone="ai" icon="sparkle">Drafted</StatusBadge> : <StatusBadge tone="neutral" icon="edit">Draft</StatusBadge>;
    case 'approved':
      return <StatusBadge tone="success" icon="check">Approved</StatusBadge>;
    case 'staged':
      return <StatusBadge tone="now" icon="note">In a canvas: Apply</StatusBadge>;
    case 'handed_off':
      return <StatusBadge tone="neutral" icon="send">With Slackbot</StatusBadge>;
    case 'landed':
      return <StatusBadge tone="success" icon="success">Landed</StatusBadge>;
    case 'not_landed':
      return <StatusBadge tone="danger" icon="error">Didn&apos;t land</StatusBadge>;
    default:
      return null;
  }
}

/** The Time ▸ Forecast mutations (each refreshes Time, Home and, for a canvas, the Outbox). */
export function useForecastActions() {
  const qc = useQueryClient();
  const details = useDetails();
  const refresh = (outbox = false) => {
    void qc.invalidateQueries({ queryKey: ['time'] });
    void qc.invalidateQueries({ queryKey: ['home'] });
    if (outbox) void qc.invalidateQueries({ queryKey: ['outbox'] });
  };
  const fail = (key: string, title: string) => (e: ApiError) => toast({ key, tone: 'error', title, body: errorText(e, 200) });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: PatchForecastRequest }) => api('patchForecast', { params: { id: v.id }, body: v.body }),
    onSuccess: () => refresh(),
    onError: fail('forecast-patch', "Couldn't save the note"),
  });
  const draft = useMutation({
    mutationFn: (ids?: string[]) => api('draftForecastNotes', { body: ids ? { ids } : {} }),
    onSuccess: (r) => {
      refresh();
      const e = r.entity;
      const n = e.queued.length + e.drafted.length;
      toast(
        n
          ? { key: 'forecast-draft', tone: 'success', title: e.queued.length ? `Drafting ${n} ${n === 1 ? 'note' : 'notes'}` : `Drafted ${n} ${n === 1 ? 'note' : 'notes'}`, body: e.queued.length ? `Read-only research, up to $${e.capUsd.toFixed(2)} in all. Each draft shows here when it's ready.` : 'Edit them, then approve.' }
          : { key: 'forecast-draft', tone: 'error', title: 'Nothing to draft', body: e.skipped[0]?.why ?? 'Every queued note has a draft already' },
      );
    },
    onError: fail('forecast-draft', "Couldn't start the draft"),
  });
  // "Stage N notes": builds ONE canvas and opens its preview, where its one Apply is (nothing reaches Org62 before)
  const stage = useMutation({
    mutationFn: () => api('stageForecast', { body: {} }),
    onSuccess: (r) => {
      refresh(true);
      const e = r.entity;
      if (e.draftId) {
        details.open({ kind: 'draft', id: e.draftId, label: e.title ?? 'Specialist Forecast canvas' });
        toast({ key: 'forecast-stage', tone: 'success', title: `Staged: ${e.title ?? 'one canvas'}`, body: 'Read the canvas in the panel, then Apply it there. Nothing reaches Org62 before your Apply.' });
      } else if (e.waiting.draftIds[0]) {
        details.open({ kind: 'draft', id: e.waiting.draftIds[0], label: 'Specialist Forecast canvas' });
        toast({ key: 'forecast-stage', tone: 'info', title: 'Already staged', body: 'These updates wait in the canvas open in the panel: Apply it there.' });
      } else toast({ key: 'forecast-stage', tone: 'error', title: 'Nothing approved yet', body: 'Approve a note or a Deal Role first' });
      if (e.deferred.length) toast({ key: 'forecast-deferred', tone: 'info', title: `${e.deferred.length} more wait for the next canvas`, body: 'One canvas holds at most 12,000 characters' });
    },
    onError: fail('forecast-stage', "Couldn't build the canvas"),
  });
  const sync = useMutation({
    mutationFn: () => api('syncForecast', { body: {} }),
    onSuccess: (r) => {
      refresh();
      toast({ key: 'forecast-sync', tone: 'success', title: r.entity.queued ? 'Syncing with Org62' : 'Synced', body: r.entity.note });
    },
    onError: fail('forecast-sync', "Couldn't start the sync"),
  });
  // "I created it, check now": the worker re-reads that one opp's Specialist Forecast (read-only); the row shows the result
  const check = useMutation({
    mutationFn: (opportunityId: string) => api('checkMissingForecast', { params: { id: opportunityId }, body: {} }),
    onSuccess: (r) => {
      refresh();
      toast({ key: `forecast-check:${r.entity.check.opportunityId}`, tone: r.entity.check.status === 'found' ? 'success' : 'info', title: r.entity.check.status === 'found' ? 'Already found' : 'Checking Org62', body: r.entity.note });
    },
    onError: fail('forecast-check', "Couldn't start the check"),
  });
  return { patch, draft, stage, sync, check, openDraft: (id: string, label?: string) => details.open({ kind: 'draft', id, label: label ?? 'Specialist Forecast canvas' }) };
}

/** A pre-filled note in the template ("Compelling event: · In quarter: …") for "Write my own". */
export function templateSkeleton(template: string): string {
  return template
    .split(/\s+·\s+/)
    .map((p) => `${p.split(':')[0]!.trim()}: `)
    .join(' · ');
}

const EDITABLE = new Set(['drafted', 'approved', 'not_landed', 'none', 'landed']);

/** A handed-off note: its canvas in Slack (Open ↗) and the Slackbot prompt, until the next sync sees it land. */
function HandedOff({ draftId, withSlackbot }: { draftId: string | null; withSlackbot: ForecastPayload['withSlackbot'] }) {
  const c = draftId ? withSlackbot.find((x) => x.draftId === draftId) : undefined;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
      <span>Tell Slackbot &quot;Execute this canvas&quot;; the next sync checks it</span>
      {c?.url ? <OpenResult href={c.url} label="Open the canvas" testId="forecast-note-canvas" /> : null}
      {c ? <CopyPromptButton prompt={forecastCanvasPrompt({ title: c.title, url: c.url, notes: c.notes, roles: c.roles })} title={c.title} testId="forecast-note-prompt" /> : null}
    </span>
  );
}

/**
 * One record's note: Draft (✦, read-only research) or write your own → edit (saved on blur) → Approve. In a canvas,
 * with Slackbot and landed show where it is; didn't land goes in the next canvas.
 */
export function NoteEditor({ row, view, compact }: { row: ForecastRow; view: Pick<ForecastPayload, 'thresholds' | 'drafting' | 'mode'> & Partial<Pick<ForecastPayload, 'withSlackbot'>>; compact?: boolean }) {
  const a = useForecastActions();
  const n = row.notes;
  const [text, setText] = useState(n.text ?? '');
  const [writing, setWriting] = useState(false);
  useEffect(() => setText(n.text ?? ''), [n.text]);
  const busy = a.patch.isPending && a.patch.variables?.id === row.id;
  const save = (body: PatchForecastRequest) => a.patch.mutate({ id: row.id, body });
  const showEditor = n.text !== null && EDITABLE.has(n.state) && n.state !== 'landed' ? true : writing;
  const changed = text.trim() !== (n.text ?? '').trim();
  const costLine = n.origin === 'model' ? (view.mode === 'mock' ? 'placeholder draft (mock)' : n.costUsd ? `$${n.costUsd.toFixed(2)}` : null) : n.origin === 'edited' ? 'edited by you' : n.origin === 'manual' ? 'written by you' : null;

  if (n.state === 'drafting')
    return (
      <div className="flex items-center gap-2 text-caption text-muted" data-testid="forecast-drafting">
        <UpdateBadge state="drafting" />
        <span>Reading the manager notes, Slack and meetings since the last update…</span>
      </div>
    );
  if (n.state === 'staged' || n.state === 'handed_off' || n.state === 'landed')
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <UpdateBadge state={n.state} origin={n.origin} />
          {n.state === 'staged' && n.draftId ? (
            <Button size="sm" variant="quiet" onClick={() => a.openDraft(n.draftId!)} data-testid="forecast-open-canvas">
              Review & apply
            </Button>
          ) : null}
          {n.state === 'handed_off' ? <HandedOff draftId={n.draftId} withSlackbot={view.withSlackbot ?? []} /> : null}
        </div>
        {n.text ? <p className={cn('text-body text-muted', compact && 'line-clamp-2')}>{n.text}</p> : null}
      </div>
    );

  if (!showEditor)
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button size="sm" variant="ai" loading={a.draft.isPending && a.draft.variables?.[0] === row.id} onClick={() => a.draft.mutate([row.id])} title={view.mode === 'mock' ? 'Mock mode: a placeholder draft, no model call' : `A read-only research run, up to $${view.drafting.perDraftUsd.toFixed(2)}`} data-testid="forecast-draft">
          Draft
        </Button>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            setText(templateSkeleton(view.thresholds.template));
            setWriting(true);
          }}
        >
          Write my own
        </Button>
        {n.error ? <span className="text-caption text-danger-700">{n.error}</span> : null}
      </div>
    );

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="forecast-editor">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <UpdateBadge state={n.text === null ? 'drafted' : n.state} origin={n.origin ?? 'manual'} />
        {costLine ? <span className="text-caption text-muted">{costLine}</span> : null}
        {n.state === 'not_landed' ? <span className="text-caption text-muted">Org62 doesn&apos;t show it: it goes in the next canvas</span> : null}
      </div>
      <textarea
        aria-label={`Forecast note for ${row.opportunityName ?? row.name}`}
        className="min-h-20 w-full min-w-0 resize-y rounded-md border border-line bg-surface px-3 py-2 text-body text-fg"
        rows={compact ? 3 : 5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (changed && text.trim()) save({ notes: text.trim() });
        }}
        data-testid="forecast-text"
      />
      {n.sources.length ? (
        <p className="truncate text-caption text-muted" title={n.sources.map((s) => s.label).join(' · ')}>
          From:{' '}
          {n.sources.map((s, i) => (
            <span key={`${s.label}-${i}`}>
              {i ? ' · ' : ''}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer" className="text-link hover:underline">
                  {s.label}
                </a>
              ) : (
                s.label
              )}
            </span>
          ))}
        </p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {n.state === 'approved' && !changed ? (
          <Button size="sm" variant="quiet" loading={busy} onClick={() => save({ notesState: 'drafted' })}>
            Unapprove
          </Button>
        ) : (
          <Button size="sm" variant="secondary" icon="check" loading={busy} disabled={!text.trim()} onClick={() => save({ notes: text.trim(), notesState: 'approved' })} data-testid="forecast-approve">
            Approve
          </Button>
        )}
        {n.text !== null ? (
          <Button size="sm" variant="quiet" icon="sparkles" loading={a.draft.isPending && a.draft.variables?.[0] === row.id} onClick={() => a.draft.mutate([row.id])}>
            Draft again
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            if (n.text !== null) save({ discardNotes: true });
            setWriting(false);
          }}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}

/** Deal Role None → a value (Aware unless you pick another) → Approve; then the canvas carries it. */
export function RoleFix({ row }: { row: ForecastRow }) {
  const a = useForecastActions();
  const fix = row.roleFix;
  const [value, setValue] = useState<string>(fix?.to ?? 'Aware');
  useEffect(() => setValue(fix?.to ?? 'Aware'), [fix?.to]);
  const st = row.role.state;
  if (st === 'staged' || st === 'handed_off' || st === 'landed' || st === 'not_landed')
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <UpdateBadge state={st} />
        <span className="text-caption text-muted">{`Deal Role → ${fix?.to ?? row.dealRole ?? ''}`}</span>
        {st === 'staged' && row.role.draftId ? (
          <Button size="sm" variant="quiet" onClick={() => a.openDraft(row.role.draftId!)}>
            Review & apply
          </Button>
        ) : null}
      </span>
    );
  if (!fix) return null;
  const busy = a.patch.isPending && a.patch.variables?.id === row.id;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-caption text-muted">{`Deal Role ${fix.from ?? '(empty)'} →`}</span>
      <select aria-label={`Deal Role for ${row.opportunityName ?? row.name}`} className="h-8 rounded-md border border-line bg-surface px-2 text-body" value={value} disabled={fix.approved} onChange={(e) => setValue(e.target.value)} data-testid="forecast-role-select">
        {['Aware', 'Assist', 'Lead', 'Portfolio', 'Accelerate', 'Incremental', 'Originate'].map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {fix.approved ? (
        <>
          <UpdateBadge state="approved" />
          <Button size="sm" variant="quiet" loading={busy} onClick={() => a.patch.mutate({ id: row.id, body: { dealRole: null } })}>
            Undo
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" icon="check" loading={busy} onClick={() => a.patch.mutate({ id: row.id, body: { dealRole: value as 'Aware' } })} data-testid="forecast-role-approve">
          Approve
        </Button>
      )}
    </span>
  );
}

export function OrgLink({ url, label = 'Open in Org62' }: { url: string | null; label?: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-caption font-bold whitespace-nowrap text-link hover:underline">
      {label} <Icon name="new_window" size="xs" />
    </a>
  );
}
