'use client';
/**
 * Time ▸ Needs you (docs/ui/time-redesign.md): the open rows that cannot log without you, grouped by what is missing
 * (Not in Org62 → No opportunity → No task type → Hours to check → Check and approve; ./path-derive.ts needsYou).
 *
 * Each row says what is off in plain English (src/lib/time-issues.ts: never the engine's canvas notes), shows the
 * app's suggestion (an opp, or internal work: src/lib/time-suggest.ts) with one-click Accept, and carries every field
 * inline: the opportunity picker (the suggestion first, "Internal (no opportunity)" near the top, the likely account's
 * opps, Org62 search), the task type, the hours, Approve. The chevron opens how it came in (its sources with links,
 * why the app proposed it) and its other fields (description, CF / CR); a click on the row opens it in the docked
 * panel. Saves go through PATCH /activity/:id on the pick; a fix that completes a held row also approves it
 * (fixPatch), so it moves to Log it ▸ Ready to log.
 *
 * Multi-select: tick rows (or "Select all", "Select the N with a suggestion", a group's "Select these"), then Accept
 * their suggestions, set one opportunity, mark them internal, set one type, or approve the complete ones. Every bulk
 * button names how many rows it acts on; each is one toast with one Undo (./bulk.ts). A long group pages in steps of
 * 50 with the count said (2026-11-13 audit C7: a list never stops silently).
 */
import { useMemo, useRef, useState } from 'react';
import type { ActivityEntry } from '@/contract';
import { useArrivalHold, useLiveList, type LiveRowState } from '@/components/lists/live-list';
import { useRightPanel } from '@/components/shell/panel';
import { SourceChip } from '@/components/domain/lib';
import { Button, cn, Icon, LivePill, ShowMore, useNow, useShowMore } from '@/ui';
import { usePatchRows } from './bulk';
import { READBACK_LABEL, readbackState } from './derive';
import { OppPicker } from './OppPicker';
import { fixPatch, rowsAndHours, type NeedCluster, type NeedGroup, type NeedsYou as Needs } from './path-derive';
import { RelogActions } from './RelogActions';
import { acceptPatch, completeForApprove } from './rows-derive';
import { DescriptionInput, FIELD, FIELD_CALM, HoursField, IssueLines, MeetingTypeField, OppField, RowEvidence, STOP, SuggestionLine, TaskTypeField, useRowSave, WhenText, type Pickers } from './RowParts';

export interface NeedsYouProps {
  needs: Needs;
  tz?: string;
  taskTypeRequired: boolean;
  /** The persona's task types (the type pickers). */
  taskTypes: string[];
  /** D-64: offer "Internal (no opportunity)" (the persona logs internal-only work). */
  internalActivity?: boolean;
  /** Open a row in the docked panel. */
  onOpen: (id: string) => void;
  /** Jump to a row in the week's rows (its week loads first). */
  onShow: (ids: string[]) => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Toggle = (ids: string[], on?: boolean) => void;
type LiveOf = (id: string) => LiveRowState | undefined;

const liveKey = (g: string, c: string, id: string) => `${g}|${c}|${id}`;
const entryOfKey = (k: string) => k.slice(k.lastIndexOf('|') + 1);

/**
 * Live (docs/UX.md "Live updates"): the shared live-list merge over every group's rows. A suggestion that comes in
 * enters at its place marked in the AI color; a row fixed elsewhere fades out where it was; rows you are editing never
 * move (typing in a row holds arrivals). Pure regrouping: the groups and clusters are the server's, in its order.
 */
function useLiveNeeds(needs: Needs): { needs: Needs; liveOf: LiveOf; holdRef: React.RefObject<HTMLDivElement | null>; held: number; showHeld: () => void } {
  const panel = useRightPanel();
  const holdRef = useRef<HTMLDivElement | null>(null);
  const hold = useArrivalHold(holdRef);
  const flat = useMemo(() => needs.groups.flatMap((g) => g.clusters.flatMap((c) => c.rows.map((e) => ({ id: liveKey(g.kind, c.key, e.id), e })))), [needs.groups]);
  const openId = panel.open && panel.tab === 'details' ? (panel.entity?.id ?? null) : null;
  const keep = openId ? (flat.find((x) => entryOfKey(x.id) === openId)?.id ?? null) : null;
  // never a burst hold: these are rows waiting on you (a scan that finds 10 shows 10); typing in a row holds, with the pill
  const live = useLiveList(flat, 'needs', { hold, keep, tone: 'ai', localId: entryOfKey, burst: Infinity });
  const out = useMemo<Needs>(() => {
    const byCluster = new Map<string, ActivityEntry[]>();
    for (const x of live.items) {
      const k = x.id.slice(0, x.id.lastIndexOf('|'));
      byCluster.set(k, [...(byCluster.get(k) ?? []), x.e]);
    }
    return { ...needs, groups: needs.groups.map((g) => ({ ...g, clusters: g.clusters.map((c) => ({ ...c, rows: byCluster.get(`${g.kind}|${c.key}`) ?? c.rows })) })) };
  }, [needs, live.items]);
  return { needs: out, liveOf: live.liveOf, holdRef, held: live.held.length, showHeld: live.showHeld };
}

export function NeedsYou({ needs: serverNeeds, tz, taskTypeRequired, taskTypes, internalActivity = false, onOpen, onShow }: NeedsYouProps) {
  const pick: Pickers = { taskTypeRequired, taskTypes, internalActivity };
  const { needs, liveOf, holdRef, held, showHeld } = useLiveNeeds(serverNeeds);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // the rows a bulk fix can touch (Not in Org62 has its own two buttons per row)
  const fixable = useMemo(() => needs.groups.filter((g) => g.kind !== 'org62').flatMap((g) => g.rows), [needs.groups]);
  const byId = useMemo(() => new Map(fixable.map((e) => [e.id, e] as const)), [fixable]);
  // a row that left Needs you (fixed) leaves the selection
  const sel = useMemo(() => [...selected].map((id) => byId.get(id)).filter((e): e is ActivityEntry => !!e), [selected, byId]);
  const toggle: Toggle = (ids, on) =>
    setSelected((cur) => {
      const next = new Set(cur);
      const turnOn = on ?? !ids.every((id) => next.has(id));
      for (const id of ids) {
        if (turnOn) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  if (!needs.groups.length)
    return (
      <p className="flex items-center gap-2 text-body text-muted" data-testid="needs-none">
        <Icon name="check" size="xs" className="text-success-700" />
        Nothing needs you: every open row has what it needs to log.
      </p>
    );
  const suggested = fixable.filter((e) => !!acceptPatch(e, taskTypeRequired));
  return (
    <div ref={holdRef} className="flex min-w-0 flex-col gap-3" data-testid="needs-groups">
      <LivePill count={held} onShow={showHeld} noun={held === 1 ? 'more row' : 'more rows'} />
      {fixable.length ? <BulkBar rows={sel} all={fixable} suggested={suggested} pick={pick} onSelect={toggle} onClear={() => setSelected(new Set())} /> : null}
      {needs.groups.map((g) => (
        <Group key={g.kind} g={g} tz={tz} pick={pick} selected={selected} onToggle={toggle} onOpen={onOpen} onShow={onShow} liveOf={liveOf} />
      ))}
    </div>
  );
}

/**
 * The selection bar (sticky): what is selected, and what to do with it. Nothing selected: the ways to select (all,
 * the ones with a suggestion). Every button says how many rows it acts on.
 */
function BulkBar({ rows, all, suggested, pick, onSelect, onClear }: { rows: ActivityEntry[]; all: ActivityEntry[]; suggested: ActivityEntry[]; pick: Pickers; onSelect: Toggle; onClear: () => void }) {
  const { many, busy } = usePatchRows();
  const { taskTypeRequired } = pick;
  const n = rows.length;
  const hours = Math.round(rows.reduce((s, e) => s + e.durationH, 0) * 100) / 100;
  const accept = rows.filter((e) => !!acceptPatch(e, taskTypeRequired));
  const approve = rows.filter((e) => completeForApprove(e, taskTypeRequired));
  const spec = (what: string) => ({ key: `time:bulk-${what}`, title: (k: number) => `${what}: ${plural(k, 'row')}`, body: 'Rows that now have everything move to Log it ▸ Ready to log.' });
  const done = (k: number) => {
    if (k) onClear();
  };
  return (
    <div className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface px-4 py-2.5 shadow-[0_1px_0_var(--color-line)]" data-testid="needs-bulk" role="region" aria-label="Selected rows">
      {n ? (
        <>
          <span className="text-body font-bold text-fg-heading tabular-nums" aria-live="polite" data-testid="needs-selected">{`${plural(n, 'row')} selected · ${hours} h`}</span>
          {accept.length ? (
            <Button size="sm" variant="primary" disabled={busy} data-testid="bulk-accept" title="Take the app's suggestion on each of them" onClick={async () => done(await many(accept, (e) => acceptPatch(e, taskTypeRequired)!, spec('Accepted the suggestion')))}>
              {accept.length === n ? `Accept ${plural(n, 'suggestion')}` : `Accept the ${accept.length} ${accept.length === 1 ? 'suggestion' : 'suggestions'}`}
            </Button>
          ) : null}
          <span className="inline-flex w-72 max-w-full" data-testid="bulk-opp">
            <OppPicker
              entry={rows[0]!}
              triggerLabel={busy ? 'Saving…' : `Set one opportunity for ${plural(n, 'row')}…`}
              disabled={busy}
              className={cn(FIELD, 'h-8 border-line-strong font-bold text-link')}
              onPick={async (oppId, shown) => {
                if (!oppId) return;
                done(await many(rows, (e) => fixPatch(e, { oppId }, taskTypeRequired), spec(`Opportunity set to ${shown.oppName ?? 'the pick'}`), { oppName: shown.oppName, accountName: shown.accountName ?? undefined }));
              }}
              onAdded={async (entity) => {
                // the first row took the opp added from Org62: the rest follow with it
                if (!entity.oppId) return;
                done(await many(rows.slice(1), (e) => fixPatch(e, { oppId: entity.oppId }, taskTypeRequired), spec(`Opportunity set to ${entity.oppName ?? 'the pick'}`), { oppName: entity.oppName, accountName: entity.accountName }));
              }}
              onInternal={pick.internalActivity ? async () => done(await many(rows, (e) => fixPatch(e, { internal: true }, taskTypeRequired), spec('Marked internal (no opportunity)'), { oppName: null, accountName: null })) : undefined}
            />
          </span>
          {pick.internalActivity ? (
            <Button size="sm" variant="secondary" disabled={busy} data-testid="bulk-internal" title="Internal work: Related To empty in Org62, an internal type" onClick={async () => done(await many(rows, (e) => fixPatch(e, { internal: true }, taskTypeRequired), spec('Marked internal (no opportunity)'), { oppName: null, accountName: null }))}>
              {`Mark ${plural(n, 'row')} internal`}
            </Button>
          ) : null}
          {taskTypeRequired ? (
            <select
              aria-label={`Set the task type for ${plural(n, 'row')}`}
              disabled={busy}
              value=""
              data-testid="bulk-type"
              onChange={async (ev) => {
                const v = ev.target.value;
                if (v) done(await many(rows, (e) => fixPatch(e, { taskType: v }, taskTypeRequired), spec(`Task type set to ${v}`)));
              }}
              className={cn(FIELD, FIELD_CALM, 'h-8 w-60 font-bold text-link')}
            >
              <option value="">{`Set the type for ${plural(n, 'row')}…`}</option>
              {pick.taskTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : null}
          {approve.length ? (
            <Button size="sm" variant="secondary" disabled={busy} data-testid="bulk-approve" title="Log them as they are: they move to Log it ▸ Ready to log" onClick={async () => done(await many(approve, () => ({ status: 'approved' }), spec('Approved')))}>
              {approve.length === n ? `Approve ${plural(n, 'row')}` : `Approve the ${approve.length} complete`}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onClear} className="ml-auto">
            Clear
          </Button>
        </>
      ) : (
        <>
          <span className="text-body text-muted">Tick rows to fix them together, or fix each one in its row.</span>
          <Button size="sm" variant="quiet" onClick={() => onSelect(all.map((e) => e.id), true)} data-testid="select-all">
            {`Select all ${all.length}`}
          </Button>
          {suggested.length ? (
            <Button size="sm" variant="quiet" onClick={() => onSelect(suggested.map((e) => e.id), true)} data-testid="select-suggested">
              {`Select the ${plural(suggested.length, 'row')} with a suggestion`}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function SelectThese({ ids, selected, onToggle }: { ids: string[]; selected: Set<string>; onToggle: Toggle }) {
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <button type="button" className="rounded-sm text-caption font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus" onClick={() => onToggle(ids)} data-testid="select-these">
      {all ? 'Unselect these' : `Select these ${ids.length}`}
    </button>
  );
}

function Group({ g, tz, pick, selected, onToggle, onOpen, onShow, liveOf }: { g: NeedGroup; tz?: string; pick: Pickers; selected: Set<string>; onToggle: Toggle; onOpen: (id: string) => void; onShow: (ids: string[]) => void; liveOf: LiveOf }) {
  // a sub-head per account or source only where one holds several rows (single rows read as one list)
  const single = g.clusters.length === 1 || g.clusters.every((c) => c.rows.length === 1);
  const selectable = g.kind !== 'org62';
  return (
    <section aria-labelledby={`need-${g.kind}-h`} data-need={g.kind} className="@container/need min-w-0 rounded-lg bg-surface">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 pb-2">
        <h3 id={`need-${g.kind}-h`} className="text-body-lg font-bold text-fg-heading">
          {g.title}
        </h3>
        <span className="text-caption text-muted tabular-nums">{rowsAndHours(g.rows.length, g.hours)}</span>
        <span className="min-w-0 basis-full text-caption text-muted @min-[40rem]/need:basis-auto">{g.why}</span>
        {selectable && g.rows.length > 1 ? (
          <span className="ml-auto">
            <SelectThese ids={g.ids} selected={selected} onToggle={onToggle} />
          </span>
        ) : null}
      </div>
      {g.clusters.map((c) => (
        <Cluster key={c.key} g={g} c={c} single={single} tz={tz} pick={pick} selected={selected} onToggle={onToggle} onOpen={onOpen} onShow={onShow} liveOf={liveOf} />
      ))}
    </section>
  );
}

function Cluster({ g, c, single, tz, pick, selected, onToggle, onOpen, onShow, liveOf }: { g: NeedGroup; c: NeedCluster; single: boolean; tz?: string; pick: Pickers; selected: Set<string>; onToggle: Toggle; onOpen: (id: string) => void; onShow: (ids: string[]) => void; liveOf: LiveOf }) {
  const page = useShowMore(c.rows.length, { step: 50 });
  return (
    <div data-cluster={c.key} className="min-w-0">
      {single ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 pt-2 pb-1">
          <span className="text-caption font-bold text-fg">{c.label}</span>
          <span className="text-caption text-muted tabular-nums">{rowsAndHours(c.rows.length, c.hours)}</span>
          {c.rows.length > 1 && g.kind !== 'org62' ? (
            <span className="ml-auto">
              <SelectThese ids={c.ids} selected={selected} onToggle={onToggle} />
            </span>
          ) : null}
        </div>
      )}
      <ul className="min-w-0" aria-label={single ? g.title : `${g.title}: ${c.label}`}>
        {c.rows.slice(0, page.shown).map((e) => (
          <NeedRow key={e.id} e={e} kind={g.kind} tz={tz} pick={pick} checked={selected.has(e.id)} onCheck={g.kind === 'org62' ? undefined : () => onToggle([e.id])} onOpen={onOpen} onShow={onShow} live={liveOf(liveKey(g.kind, c.key, e.id))} />
        ))}
      </ul>
      <ShowMore shown={page.shown} total={c.rows.length} step={page.step} onMore={page.more} onAll={page.all} />
    </div>
  );
}

/**
 * A Needs-you row: tick, when, hours, what (with what is off, in plain English, and its sources), the suggestion with
 * Accept, and its fields; the chevron opens how it came in and its other fields.
 */
function NeedRow({ e, kind, tz, pick, checked, onCheck, onOpen, onShow, live }: { e: ActivityEntry; kind: NeedGroup['kind']; tz?: string; pick: Pickers; checked: boolean; onCheck?: () => void; onOpen: (id: string) => void; onShow: (ids: string[]) => void; live?: LiveRowState }) {
  const { taskTypeRequired } = pick;
  const [open, setOpen] = useState(false);
  const save = useRowSave(e, taskTypeRequired);
  const now = useNow(60_000).toISOString();
  const relog = kind === 'org62';
  const rb = relog ? readbackState(e, now) : null;
  const approve = !relog && completeForApprove(e, taskTypeRequired) && (kind === 'check' || kind === 'hours');
  return (
    <li
      data-need-row={e.id}
      data-live={live}
      data-live-tone={live === 'new' ? 'ai' : undefined}
      data-selected={checked ? '' : undefined}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest(STOP)) return;
        onOpen(e.id);
      }}
      className={cn('min-w-0 cursor-default border-t border-line px-4 py-2.5', checked ? 'bg-selected' : 'hover:bg-surface-muted')}
    >
      <div className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_2rem] items-start gap-x-3 gap-y-2 @min-[56rem]/need:grid-cols-[1.25rem_7rem_4.5rem_minmax(0,1fr)_minmax(19rem,28rem)_2rem]">
        <span className="pt-1.5">
          {onCheck ? <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${e.description || 'this row'}`} className="size-4 accent-[var(--color-accent)]" data-testid="need-check" /> : null}
        </span>
        <button type="button" onClick={() => onShow([e.id])} title="Show it in the week's rows" className="hidden rounded-sm pt-1 text-left hover:underline focus-visible:outline-none focus-visible:shadow-focus @min-[56rem]/need:block">
          <WhenText e={e} tz={tz} />
        </button>
        <span className="hidden @min-[56rem]/need:block">{relog ? <span className="block pt-1.5 text-body text-fg tabular-nums">{`${e.durationH} h`}</span> : <HoursField e={e} onSave={(h) => save({ durationH: h })} className="h-8" />}</span>
        <div className="min-w-0 space-y-1 @min-[56rem]/need:pt-1">
          <p className="line-clamp-2 text-body break-words text-fg" title={e.description}>
            {e.description || 'Activity row'}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted">
            <span className="@min-[56rem]/need:hidden">
              <WhenText e={e} tz={tz} />
            </span>
            {relog ? <span className="text-fg tabular-nums @min-[56rem]/need:hidden">{`${e.durationH} h`}</span> : null}
            {e.sources.slice(0, 3).map((s, i) => (
              <SourceChip key={`${s.kind}:${i}`} source={s} compact />
            ))}
            {e.accountName ? <span className="truncate">{e.accountName}</span> : null}
          </div>
        </div>
        <div className="col-span-3 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-2 @min-[56rem]/need:col-span-1 @min-[56rem]/need:col-start-5 @min-[56rem]/need:row-start-1" data-fixes={kind}>
          {relog ? (
            <RelogActions e={e} size="sm" now={now} />
          ) : (
            <>
              <span className="min-w-0 flex-[2_1_13rem]">
                <OppField e={e} pick={pick} save={save} />
              </span>
              {taskTypeRequired ? (
                <span className="min-w-0 flex-[1_1_9rem]">
                  <TaskTypeField e={e} pick={pick} onSave={(t) => save({ taskType: t })} />
                </span>
              ) : null}
              <span className="w-20 @min-[56rem]/need:hidden">
                <HoursField e={e} onSave={(h) => save({ durationH: h })} />
              </span>
              {approve ? (
                <Button size="sm" variant="secondary" onClick={() => save({ status: 'approved' })} data-testid="need-approve" title="Log it as it is: it moves to Log it ▸ Ready to log">
                  Approve
                </Button>
              ) : null}
            </>
          )}
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Hide how it came in' : 'Show how it came in and its other fields'}
          title={open ? 'Hide how it came in' : 'How it came in, and its other fields'}
          onClick={() => setOpen((v) => !v)}
          className="col-start-3 row-start-1 grid size-8 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:shadow-focus @min-[56rem]/need:col-start-6"
          data-testid="need-expand"
        >
          <Icon name={open ? 'chevrondown' : 'chevronright'} size="xs" />
        </button>
        {/* what is off, then the suggestion: the row's full width under its words and fields */}
        <div className="col-span-3 col-start-1 min-w-0 space-y-1.5 empty:hidden @min-[56rem]/need:col-span-2 @min-[56rem]/need:col-start-4">
          {relog ? <p className="text-caption text-danger-700">{READBACK_LABEL[rb ?? 'missing']}</p> : <IssueLines e={e} max={2} />}
          {!relog && e.suggestion ? <SuggestionLine e={e} taskTypeRequired={taskTypeRequired} /> : null}
        </div>
      </div>
      {open ? (
        <div className="mt-2 grid min-w-0 gap-4 rounded-md bg-surface-muted p-3 @min-[56rem]/need:ml-8 @min-[56rem]/need:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]" data-testid="need-details" data-no-open>
          <div className="min-w-0">
            <h4 className="mb-1.5 text-caption font-bold text-fg-heading">How it came in</h4>
            <RowEvidence e={e} tz={tz} />
          </div>
          {relog ? null : (
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
              <button type="button" className="self-start text-caption font-bold text-link hover:underline" onClick={() => onOpen(e.id)}>
                Open all of it in the details panel
              </button>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
