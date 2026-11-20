'use client';
/**
 * Time ▸ Log it ▸ Internal (no opportunity) (D-64): the internal-only work the app suggests. A repo or Drive docs no
 * account matched, a meeting with no customer that names internal work: each is a Solutions Event with Related To empty
 * and an internal task type (Asset Creation, Personal Development, Sales Enablement, Travel), the user's own Org62
 * precedent. Quiet on purpose: these never count in Needs you or the sidebar.
 *
 * Per row: its type (the internal types), Log (approve: it goes in the next batch like any approved row, Related To
 * empty), Dismiss (Dismissed by you), and More: "Dismiss all from <source>" (one repo, unmapped Drive docs, a
 * recurring series: a remembered rule with one Undo, listed in Settings ▸ Time) and "Log to an opportunity instead".
 * Bulk: Log all, Dismiss all (one toast, one Undo). PATCH /activity/:id · POST /time/dismiss-rules.
 */
import { useState } from 'react';
import type { ActivityEntry } from '@/contract';
import { INTERNAL_TASK_TYPES } from '@/engines/activity/internal';
import { useOptimisticMutation } from '@/client/optimistic/useOptimisticMutation';
import { SourceChip } from '@/components/domain/lib';
import { clock, dayLabel } from '@/components/domain/lib/time';
import { Button, cn, Icon, Menu } from '@/ui';
import { usePatchRows } from './bulk';
import { fmtH } from './derive';
import { OppPicker } from './OppPicker';
import { rowsAndHours, rowWarnings, type InternalGroup } from './path-derive';
import { plainIssue, plainIssues } from '@/lib/time-issues';

const FIELD = 'h-8 min-w-0 rounded-md border border-line-input bg-surface-input px-2 text-body text-fg hover:border-line-strong focus:border-accent focus:outline-none';
const STOP = 'input,select,textarea,button,a,[role="combobox"],[role="listbox"],[role="menu"]';

export interface InternalRowsProps {
  group: InternalGroup;
  tz?: string;
  /** Open a row in the docked panel. */
  onOpen: (id: string) => void;
  /** Jump to a row in the week's rows. */
  onShow: (ids: string[]) => void;
}

export function InternalRows({ group, tz, onOpen, onShow }: InternalRowsProps) {
  const { many, busy } = usePatchRows();
  if (!group.rows.length) return null;
  const spec = (what: string) => ({ key: `time:internal-${what}`, title: (n: number) => `${what} ${n} internal ${n === 1 ? 'row' : 'rows'}` });
  return (
    <section id="time-internal" aria-labelledby="time-internal-h" data-testid="time-internal" className="@container/internal flex min-w-0 scroll-mt-4 flex-col rounded-lg bg-surface">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 pb-2">
        <h3 id="time-internal-h" className="text-body-lg font-bold text-fg-heading">
          Internal (no opportunity)
        </h3>
        <span className="text-caption text-muted tabular-nums">{rowsAndHours(group.rows.length, group.hours)}</span>
        <span className="min-w-0 basis-full text-caption text-muted @min-[44rem]/internal:basis-auto">Work for no customer: it logs with Related To empty and an internal type. Log puts it on your next canvas.</span>
        <span className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="secondary" disabled={busy} onClick={() => void many(group.rows, () => ({ status: 'approved' }), { ...spec('Logged'), body: 'They go on your next canvas (Ready to log), Related To empty.' })} data-testid="internal-log-all">
            {`Log all ${group.rows.length}`}
          </Button>
          <Button size="xs" variant="quiet" disabled={busy} onClick={() => void many(group.rows, () => ({ status: 'dismissed' }), spec('Dismissed'))} data-testid="internal-dismiss-all">
            {`Dismiss all ${group.rows.length}`}
          </Button>
        </span>
      </div>
      <ul className="min-w-0" aria-label="Internal (no opportunity)">
        {group.rows.map((e) => (
          <InternalRow key={e.id} e={e} tz={tz} onOpen={onOpen} onShow={onShow} />
        ))}
      </ul>
    </section>
  );
}

function InternalRow({ e, tz, onOpen, onShow }: { e: ActivityEntry; tz?: string; onOpen: (id: string) => void; onShow: (ids: string[]) => void }) {
  const { one } = usePatchRows();
  const [picking, setPicking] = useState(false);
  const rule = useOptimisticMutation({
    route: 'dismissFromSource',
    topics: ['time', 'settings'],
    optimistic: (_i, cache) => cache.patchEntity(e.id, (x) => ({ ...x, status: 'dismissed', excludedReason: 'dismiss_rule' })),
    toast: (r) => ({ title: `Dismissed all from ${r.entity.rule.label}: ${rowsWord(r.entity.dismissedIds.length)}`, body: 'New rows from it are dismissed too. Remove the rule in Settings ▸ Time ▸ Dismissed sources.' }),
  });
  const raw = rowWarnings(e).find((i) => !/^GUESS:/.test(i)) ?? null;
  const why = raw ? plainIssue(raw, e) : null;
  const types = e.taskType && !(INTERNAL_TASK_TYPES as readonly string[]).includes(e.taskType) ? [e.taskType, ...INTERNAL_TASK_TYPES] : [...INTERNAL_TASK_TYPES];
  const src = e.dismissSource;
  return (
    <li
      data-internal-row={e.id}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest(STOP)) return;
        onOpen(e.id);
      }}
      className="grid min-w-0 cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t border-line px-4 py-2.5 hover:bg-surface-muted @min-[48rem]/internal:grid-cols-[8.5rem_3.5rem_minmax(0,1fr)_auto]"
    >
      <button type="button" onClick={() => onShow([e.id])} title="Show it in the week's rows" className="flex min-w-0 flex-col items-start rounded-sm text-left text-caption tabular-nums hover:underline focus-visible:outline-none focus-visible:shadow-focus">
        <span className="font-bold text-fg">{dayLabel(`${e.date}T12:00:00Z`, 'UTC')}</span>
        <span className="text-muted">{`${clock(e.start, tz)}–${clock(e.end, tz)}`}</span>
      </button>
      <span className="text-right text-body tabular-nums text-fg @min-[48rem]/internal:text-left">{fmtH(e.durationH)}</span>
      <div className="col-span-2 min-w-0 @min-[48rem]/internal:col-span-1">
        <p className="line-clamp-2 text-body break-words text-fg" title={e.description}>
          {e.description || 'Internal work'}
        </p>
        <p className="flex min-w-0 items-center gap-1 text-caption text-muted">
          {e.sources.slice(0, 2).map((s, i) => (
            <SourceChip key={`${s.kind}:${i}`} source={s} compact />
          ))}
          <span className="line-clamp-1 min-w-0 break-words" title={plainIssues(e).join(' · ')}>
            {why ?? 'No account or opportunity matched'}
          </span>
        </p>
      </div>
      <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-2 @min-[48rem]/internal:col-span-1" data-internal-actions>
        {picking ? (
          <span className="w-64 max-w-full">
            <OppPicker entry={e} className={cn(FIELD, 'h-auto min-h-8 w-full py-1')} onPick={(oppId, shown) => oppId && void one(e, { oppId }, { oppName: shown.oppName, accountName: shown.accountName ?? undefined })} />
          </span>
        ) : (
          <select aria-label="Task type" value={e.taskType ?? ''} onChange={(ev) => ev.target.value && void one(e, { taskType: ev.target.value })} className={cn(FIELD, 'w-52')}>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <Button size="xs" variant="secondary" onClick={() => void one(e, { status: 'approved' })} data-testid="internal-log" title="Approve it: it goes on your next canvas, Related To empty">
          Log
        </Button>
        <Button size="xs" variant="quiet" onClick={() => void one(e, { status: 'dismissed' })} data-testid="internal-dismiss" title="Not logged: Dismissed by you">
          Dismiss
        </Button>
        <Menu
          label={`More for ${e.description || 'this row'}`}
          trigger={
            <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-caption text-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:shadow-focus" data-testid="internal-more">
              More <Icon name="chevrondown" size="xs" />
            </button>
          }
          items={[
            ...(src
              ? [{ id: 'rule', label: `Dismiss all from ${src.label}`, description: src.kind === 'series' ? 'Every meeting of this series, now and later' : src.kind === 'repo' ? 'Every work block of this repo, now and later' : 'Every unmapped Drive docs block, now and later', onSelect: () => rule.mutate({ body: { entryId: e.id } }) }]
              : []),
            { id: 'opp', label: 'Log to an opportunity instead…', description: 'Pick the opportunity it was for', onSelect: () => setPicking(true) },
          ]}
        />
      </div>
    </li>
  );
}

const rowsWord = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;
