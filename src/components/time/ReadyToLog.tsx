'use client';
/**
 * Time ▸ Log it ▸ Ready to log: the rows that have ended and have what they need (approved, or complete and
 * suggested: approved with the batch), listed, so "Log to Slackbot" says exactly which rows it takes. Each row keeps
 * its fields editable inline (opportunity, task type, hours; the chevron opens how it came in, its description and CF /
 * CR), the same as in Needs you, and saves through PATCH /activity/:id. Tick rows to log only those; with none ticked
 * the button takes every row listed, and its label says so ("Log these 4 rows to Slackbot · 6.5 h"). DC requests ride
 * along on the same canvas (their link says which).
 *
 * D-70: a use case is a row like any other (its create or field fix in Org62, "Org62 — · VDP ✓"), and so is an update
 * to an Event already in Org62 ("update · Duration 2 h → 3 h", proposed by the re-derive: approve or dismiss it, or log
 * it: a complete proposed update is approved with the batch like a complete row). Each kind ticks the same way, and
 * the button names them all ("Log 3 rows, 2 use cases and 1 update to Slackbot · 4.5 h").
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { ActivityEntry, EventUpdateRow, UseCaseLanding } from '@/contract';
import { api } from '@/client/api';
import { toast } from '@/client/toast';
import { SourceChip } from '@/components/domain/lib';
import { errorText } from '@/lib/error-text';
import { Button, cn, Icon, LivePill, ShowMore, StatePill, useShowMore } from '@/ui';
import { useArrivalHold, useLiveList, type LiveRowState } from '@/components/lists/live-list';
import { fmtH } from './derive';
import { LandingPills } from './LandingParts';
import { DescriptionInput, HoursField, IssueLines, MeetingTypeField, OppField, RowEvidence, STOP, TaskTypeField, useRowSave, WhenText, type Pickers } from './RowParts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sumH = (xs: readonly ActivityEntry[]) => Math.round(xs.reduce((s, e) => s + e.durationH, 0) * 100) / 100;

/** What a batch takes: ticked rows, use cases (round-trip keys) and Event updates (write ids); null: everything ready. */
export type ReadySelection = { ids: string[]; useCases: string[]; updates: string[] } | null;

export interface ReadyToLogProps {
  rows: ActivityEntry[];
  /** D-70: use cases ready to log (a create or a field fix in Org62). */
  useCases?: UseCaseLanding[];
  /** D-70: updates to Events already in Org62 (proposed or approved). */
  updates?: EventUpdateRow[];
  tz?: string;
  pick: Pickers;
  /** Stage the batch: the ticked ones (null: everything ready). */
  onLog: (sel: ReadySelection) => void;
  logging: boolean;
  /** The use cases or Event updates are still loading: the button waits (it would name fewer than it logs). */
  counting?: boolean;
  /** Kept current with what the button would log (the ticked ones, or null: everything ready), for the page's ⌘↵. */
  selectionRef?: MutableRefObject<ReadySelection>;
  /** This button is the page's one filled action (⌘↵). */
  primary: boolean;
  /** What rides along (DC requests, use cases), as links. */
  along?: ReactNode;
  /** Quiet second verbs (Approve N now, Log DCs now). */
  secondary?: ReactNode;
  onOpen: (id: string) => void;
  onShow: (ids: string[]) => void;
}

/** "4 rows", "4 rows and 2 use cases", "3 rows, 2 use cases and 1 update". */
function kindsWord(rows: number, ucs: number, ups: number): string {
  const parts = [rows ? plural(rows, 'row') : null, ucs ? plural(ucs, 'use case') : null, ups ? plural(ups, 'update') : null].filter((x): x is string => !!x);
  return parts.length <= 1 ? (parts[0] ?? '0 rows') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * "Log these 4 rows to Slackbot · 6.5 h" / "Log the 2 ticked rows to Slackbot · 3 h"; with use cases and updates,
 * "Log 3 rows, 2 use cases and 1 update to Slackbot · 4.5 h" (hours are the rows' only).
 */
export function logButtonLabel(all: readonly ActivityEntry[], ticked: readonly ActivityEntry[], more: { useCases?: number; updates?: number; tickedUseCases?: number; tickedUpdates?: number } = {}): string {
  const ucs = more.useCases ?? 0;
  const ups = more.updates ?? 0;
  const tUcs = more.tickedUseCases ?? 0;
  const tUps = more.tickedUpdates ?? 0;
  const anyTicked = ticked.length + tUcs + tUps > 0;
  const total = all.length + ucs + ups;
  if (!ucs && !ups) {
    if (ticked.length && ticked.length < all.length) return `Log the ${plural(ticked.length, 'ticked row')} to Slackbot · ${fmtH(sumH(ticked))}`;
    return all.length === 1 ? `Log this row to Slackbot · ${fmtH(sumH(all))}` : `Log these ${all.length} rows to Slackbot · ${fmtH(sumH(all))}`;
  }
  const h = (xs: readonly ActivityEntry[]) => (xs.length ? ` · ${fmtH(sumH(xs))}` : '');
  if (anyTicked && ticked.length + tUcs + tUps < total) return `Log the ticked ${kindsWord(ticked.length, tUcs, tUps)} to Slackbot${h(ticked)}`;
  return `Log ${kindsWord(all.length, ucs, ups)} to Slackbot${h(all)}`;
}

export function ReadyToLog({ rows: serverRows, useCases = [], updates = [], tz, pick, onLog, logging, counting = false, selectionRef, primary, along, secondary, onOpen, onShow }: ReadyToLogProps) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  // Live (docs/UX.md "Live updates"): a row that becomes ready slides in at its time, marked; one logged or edited
  // elsewhere fades out in place. Rows fading out are shown but never counted or logged.
  // Rows you approve are never held back as a burst (2026-11-16: approving 70 rows left 1 on screen and the rest
  // hidden, with no pill): only a row you are typing in holds arrivals, and then the pill says how many wait.
  const listRef = useRef<HTMLUListElement | null>(null);
  const hold = useArrivalHold(listRef);
  const live = useLiveList(serverRows, 'ready', { hold, burst: Infinity });
  const rows = useMemo(() => live.items.filter((e) => !live.isLeaving(e.id)), [live]);
  const page = useShowMore(live.items.length, { step: 50 });
  const sel = useMemo(() => rows.filter((e) => ticked.has(e.id)), [rows, ticked]);
  // With nothing ticked the button takes every row the server has ready (stageLogBatch with no ids), held arrivals
  // too: its label counts those, never just the rows placed on screen so far.
  const allRows = serverRows;
  const selUcs = useMemo(() => useCases.filter((x) => ticked.has(`uc|${x.key}`)), [useCases, ticked]);
  const selUps = useMemo(() => updates.filter((x) => ticked.has(`up|${x.writeId}`)), [updates, ticked]);
  const toggle = (id: string) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const total = allRows.length + useCases.length + updates.length;
  const nTicked = sel.length + selUcs.length + selUps.length;
  const some = nTicked > 0 && nTicked < total;
  const selection: ReadySelection = some ? { ids: sel.map((e) => e.id), useCases: selUcs.map((x) => x.key), updates: selUps.map((x) => x.writeId) } : null;
  // ⌘↵ (the page's binding, Q4Log) logs exactly what this button would: the ticked ones, or everything ready
  useEffect(() => {
    if (selectionRef) selectionRef.current = selection;
  });
  return (
    <div className="@container/ready flex min-w-0 flex-col" data-testid="ready-to-log">
      <LivePill count={live.held.length} onShow={live.showHeld} noun={live.held.length === 1 ? 'more row' : 'more rows'} />
      {rows.length ? (
        <>
          <ul ref={listRef} className="min-w-0" aria-label="Rows ready to log">
            {live.items.slice(0, page.shown).map((e) => (
              <ReadyRow key={e.id} e={e} tz={tz} pick={pick} checked={ticked.has(e.id)} onCheck={() => toggle(e.id)} onOpen={onOpen} onShow={onShow} live={live.liveOf(e.id)} />
            ))}
          </ul>
          <ShowMore shown={page.shown} total={rows.length} step={page.step} onMore={page.more} onAll={page.all} />
        </>
      ) : null}
      {updates.length ? (
        <ul className="min-w-0 border-t border-line" aria-label="Event updates ready to log" data-testid="ready-updates">
          {updates.map((u) => (
            <UpdateRow key={u.writeId} u={u} checked={ticked.has(`up|${u.writeId}`)} onCheck={() => toggle(`up|${u.writeId}`)} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
      {useCases.length ? (
        <ul className="min-w-0 border-t border-line" aria-label="Use cases ready to log" data-testid="ready-use-cases">
          {useCases.map((x) => (
            <UseCaseRow key={x.key} x={x} checked={ticked.has(`uc|${x.key}`)} onCheck={() => toggle(`uc|${x.key}`)} />
          ))}
        </ul>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3">
        {total || counting ? (
          <Button size={primary ? 'md' : 'sm'} variant={primary ? 'primary' : 'secondary'} loading={logging || counting} disabled={counting} kbd={primary && !counting ? 'mod+enter' : undefined} onClick={() => !counting && onLog(selection)} data-testid="q4-submit">
            {counting ? 'Counting what is ready…' : logButtonLabel(allRows, sel, { useCases: useCases.length, updates: updates.length, tickedUseCases: selUcs.length, tickedUpdates: selUps.length })}
          </Button>
        ) : null}
        {some ? (
          <button type="button" className="text-caption font-bold text-link hover:underline" onClick={() => setTicked(new Set())}>
            {`Untick: log all ${total}`}
          </button>
        ) : null}
        {secondary}
        <span className="min-w-0 basis-full text-caption text-muted @min-[44rem]/ready:basis-auto">
          {total ? 'One new private canvas, waiting for your Apply here. Nothing leaves before that.' : null}
          {along ? <> {along}</> : null}
        </span>
      </div>
    </div>
  );
}

/** D-70: one use case ready to log: what it sends to Org62, where it is now, tick it, or leave it out of Org62. */
function UseCaseRow({ x, checked, onCheck }: { x: UseCaseLanding; checked: boolean; onCheck: () => void }) {
  const [busy, setBusy] = useState(false);
  const leave = async () => {
    setBusy(true);
    try {
      const r = await api('fixUseCase', { params: { key: x.key }, body: { leave: true } });
      toast({ key: `uc-leave:${x.key}`, tone: 'success', title: `${x.title}: left out of Org62`, body: 'It stays in VDP. Activity ▸ Org62 ▸ Use cases brings it back.', undo: r.auditId ? { auditId: r.auditId } : undefined });
    } catch (err) {
      toast({ key: `uc-leave:${x.key}`, tone: 'error', title: 'Couldn’t leave it out', body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={cn('min-w-0 border-t border-line px-4 py-2.5 first:border-t-0', checked ? 'bg-selected' : 'hover:bg-surface-muted')} data-ready-use-case={x.key}>
      <div className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
        <span className="pt-1">
          <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Log only the ticked ones: ${x.title}`} className="size-4 accent-[var(--color-accent)]" data-testid="ready-check" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-body break-words text-fg">
            <span className="font-bold">{x.title}</span>
            <StatePill tone="neutral" size="xs" label="Use case" icon={false} />
            <LandingPills org62={x.org62} vdp={x.vdp} />
          </p>
          <p className="text-caption break-words text-muted">{[x.companyName, x.oppName, x.sends].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex items-center gap-2">
          {x.vdpUrl ? (
            <a href={x.vdpUrl} target="_blank" rel="noreferrer" className="text-caption text-link hover:underline">
              VDP ↗
            </a>
          ) : null}
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => void leave()} title="It stays in VDP and never goes to Org62 (Undo, or bring it back from Use cases)">
            Leave out
          </Button>
        </div>
      </div>
    </li>
  );
}

/** D-70: one update to an Event already in Org62 ("update · Duration 2 h → 3 h"): approve, dismiss, or tick it. */
function UpdateRow({ u, checked, onCheck, onOpen }: { u: EventUpdateRow; checked: boolean; onCheck: () => void; onOpen: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (action: 'approve' | 'dismiss') => {
    setBusy(true);
    try {
      await api('patchEventUpdate', { params: { id: u.writeId }, body: { action } });
      toast({ key: `upd:${u.writeId}`, tone: 'success', title: action === 'approve' ? `Approved: ${u.summary}` : `Dismissed: ${u.summary}`, body: action === 'approve' ? 'It goes on your next canvas.' : undefined, undo: { label: 'Undo', run: async () => void (await api('patchEventUpdate', { params: { id: u.writeId }, body: { action: 'restore' } })) } });
    } catch (err) {
      toast({ key: `upd:${u.writeId}`, tone: 'error', title: 'Couldn’t change that update', body: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={cn('min-w-0 border-t border-line px-4 py-2.5 first:border-t-0', checked ? 'bg-selected' : 'hover:bg-surface-muted')} data-ready-update={u.writeId}>
      <div className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
        <span className="pt-1">
          <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Log only the ticked ones: ${u.label} ${u.summary}`} className="size-4 accent-[var(--color-accent)]" data-testid="ready-check" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-body break-words text-fg">
            <button type="button" className="font-bold hover:underline" onClick={() => onOpen(u.activityEntryId)}>
              {u.label}
            </button>
            <span className="tabular-nums" data-testid="update-summary">
              {u.summary}
            </span>
          </p>
          <p className="text-caption break-words text-muted">
            {[u.date, u.reason, u.state === 'proposed' ? 'Proposed by the app: approved when you log it' : 'Approved'].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {u.state === 'proposed' ? (
            <Button size="xs" variant="quiet" disabled={busy} onClick={() => void act('approve')}>
              Approve
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => void act('dismiss')}>
            Dismiss
          </Button>
        </div>
      </div>
    </li>
  );
}

function ReadyRow({ e, tz, pick, checked, onCheck, onOpen, onShow, live }: { e: ActivityEntry; tz?: string; pick: Pickers; checked: boolean; onCheck: () => void; onOpen: (id: string) => void; onShow: (ids: string[]) => void; live?: LiveRowState }) {
  const [open, setOpen] = useState(false);
  const save = useRowSave(e, pick.taskTypeRequired);
  return (
    <li
      data-ready-row={e.id}
      data-live={live}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest(STOP)) return;
        onOpen(e.id);
      }}
      className={cn('min-w-0 cursor-default border-t border-line px-4 py-2.5 first:border-t-0', checked ? 'bg-selected' : 'hover:bg-surface-muted')}
    >
      <div className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_2rem] items-start gap-x-3 gap-y-2 @min-[56rem]/ready:grid-cols-[1.25rem_7rem_4.5rem_minmax(0,1fr)_minmax(19rem,28rem)_2rem]">
        <span className="pt-1.5">
          <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Log only the ticked rows: ${e.description || 'this row'}`} className="size-4 accent-[var(--color-accent)]" data-testid="ready-check" />
        </span>
        <button type="button" onClick={() => onShow([e.id])} title="Show it in the week's rows" className="hidden rounded-sm pt-1 text-left hover:underline focus-visible:outline-none focus-visible:shadow-focus @min-[56rem]/ready:block">
          <WhenText e={e} tz={tz} />
        </button>
        <span className="hidden @min-[56rem]/ready:block">
          <HoursField e={e} onSave={(h) => save({ durationH: h })} className="h-8" />
        </span>
        <div className="min-w-0 space-y-1 @min-[56rem]/ready:pt-1">
          <p className="line-clamp-2 text-body break-words text-fg" title={e.description}>
            {e.description || 'Activity row'}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted">
            <span className="@min-[56rem]/ready:hidden">
              <WhenText e={e} tz={tz} />
            </span>
            {e.sources.slice(0, 3).map((s, i) => (
              <SourceChip key={`${s.kind}:${i}`} source={s} compact />
            ))}
            <span data-testid="ready-state">{e.status === 'approved' ? (e.internal ? 'Approved · internal' : 'Approved') : 'Complete: approved when you log it'}</span>
          </div>
          <IssueLines e={e} max={1} />
        </div>
        <div className="col-span-3 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-2 @min-[56rem]/ready:col-span-1 @min-[56rem]/ready:col-start-5 @min-[56rem]/ready:row-start-1">
          <span className="min-w-0 flex-[2_1_13rem]">
            <OppField e={e} pick={pick} save={save} />
          </span>
          {pick.taskTypeRequired ? (
            <span className="min-w-0 flex-[1_1_9rem]">
              <TaskTypeField e={e} pick={pick} onSave={(t) => save({ taskType: t })} />
            </span>
          ) : null}
          <span className="w-20 @min-[56rem]/ready:hidden">
            <HoursField e={e} onSave={(h) => save({ durationH: h })} />
          </span>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Hide how it came in' : 'Show how it came in and its other fields'}
          title={open ? 'Hide how it came in' : 'How it came in, and its other fields'}
          onClick={() => setOpen((v) => !v)}
          className="col-start-3 row-start-1 grid size-8 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:shadow-focus @min-[56rem]/ready:col-start-6"
          data-testid="ready-expand"
        >
          <Icon name={open ? 'chevrondown' : 'chevronright'} size="xs" />
        </button>
      </div>
      {open ? (
        <div className="mt-2 grid min-w-0 gap-4 rounded-md bg-surface-muted p-3 @min-[56rem]/ready:ml-8 @min-[56rem]/ready:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]" data-no-open>
          <div className="min-w-0">
            <h4 className="mb-1.5 text-caption font-bold text-fg-heading">How it came in</h4>
            <RowEvidence e={e} tz={tz} />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h4 className="text-caption font-bold text-fg-heading">Its other fields</h4>
            <label className="flex min-w-0 flex-col gap-1 text-caption text-muted">
              Description (the Event’s Subject)
              <DescriptionInput e={e} onSave={(d) => save({ description: d })} />
            </label>
            <div className="flex min-w-0 items-center gap-2 text-caption text-muted">
              Meeting type
              <MeetingTypeField e={e} onSave={(m) => save({ meetingType: m })} />
            </div>
            <p className="text-caption text-muted">Not this time? Tick the rows you want: only those go on the canvas.</p>
          </div>
        </div>
      ) : null}
    </li>
  );
}
