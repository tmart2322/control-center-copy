'use client';
/**
 * Watches (UI-SPEC §8, §12), as a section of the Briefs reading pane (design v2: no page-owned sheet or overlay).
 * Add a channel, opp, account, person or search; set the cadence and the style. Watches change scanning scope and
 * cost, so every change is an EXPLICIT Save (never autosave), with inline status, conflict text and Retry.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { WatchSubscription } from '@/contract';
import { api, ApiError } from '@/client/api';
import { useApi } from '@/client/hooks';
import { useOptimisticMutation } from '@/client/optimistic';
import { toast } from '@/client/toast';
import { Button, cn, EmptyState, Icon, InlineStatus, SegmentedToggle, Skeleton } from '@/ui';
import { BLANK_WATCH, cadenceLabel, normaliseWatch, watchToDraft, type WatchCadence, type WatchDraft, type WatchKind } from './watch-form';

const KINDS: Array<{ value: WatchKind; label: string }> = [
  { value: 'channel', label: 'Channel' },
  { value: 'opp', label: 'Opportunity' },
  { value: 'account', label: 'Account' },
  { value: 'person', label: 'Person' },
  { value: 'search', label: 'Search' },
];
const CADENCES: Array<{ value: WatchCadence; label: string }> = [
  { value: 'daily_0730', label: 'Daily 7:30' },
  { value: 'every_4h', label: 'Every 4 h' },
  { value: 'since_last_open', label: 'Since last open' },
];
const PLACEHOLDER: Record<WatchKind, string> = {
  channel: '#channel-name',
  opp: 'Opportunity name or Org62 id',
  account: 'Pick an account',
  person: 'Name or @handle',
  search: 'Words to watch for, e.g. "pricing" in:#channel-name',
};
const KIND_ICON: Record<WatchKind, string> = { channel: 'slack', opp: 'moneybag', account: 'account', person: 'user', search: 'search' };

export function WatchesSection({ onDone }: { onDone?: () => void }) {
  const q = useApi('listWatches');
  const watches = q.data?.watches ?? [];
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const on = watches.filter((w) => w.enabled).length;

  return (
    <section aria-labelledby="watches-h" data-testid="watches-section" className="px-6 py-5">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id="watches-h" className="text-title font-bold text-fg-heading">
            Watches
          </h2>
          <p className="mt-1 max-w-[68ch] text-body text-muted">
            A watch tells the scanner what to read and brief you on. More watches means more scanning, so changes apply only when you press Save.
            {watches.length ? ` ${on} of ${watches.length} on.` : ''}
          </p>
        </div>
        {editing !== 'new' ? (
          <Button variant="secondary" size="sm" icon="add" onClick={() => setEditing('new')} data-testid="add-watch">
            Add watch
          </Button>
        ) : null}
        {onDone ? (
          <Button variant="quiet" size="sm" onClick={onDone}>
            Back to briefs
          </Button>
        ) : null}
      </div>

      <div className="mt-4 max-w-[72rem]">
        {editing === 'new' ? (
          <div className="mb-4 rounded-lg border border-line-strong bg-surface-muted p-4">
            <WatchForm key="new" initial={BLANK_WATCH} onDone={() => setEditing(null)} />
          </div>
        ) : null}
        {q.isLoading ? (
          <Skeleton variant="row" count={4} />
        ) : q.isError ? (
          <p role="alert" className="text-body text-danger-700">
            Couldn&apos;t load watches: {q.error?.message}.{' '}
            <button type="button" className="font-bold text-link hover:underline" onClick={() => void q.refetch()}>
              Retry
            </button>
          </p>
        ) : watches.length === 0 && editing !== 'new' ? (
          <EmptyState icon="search" title="No watches yet" body="Add a channel, opportunity, account, person or search to get a brief on it." size="inline" />
        ) : (
          <ul aria-label="Watches" data-testid="watch-list" className="divide-y divide-line rounded-lg border border-line">
            {watches.map((w) => (
              <li key={w.id}>
                {editing === w.id ? (
                  <div className="bg-surface-muted p-4">
                    <WatchForm key={w.id} watch={w} initial={watchToDraft(w)} onDone={() => setEditing(null)} />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(w.id)}
                    data-testid="watch-row"
                    className="group/w flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]"
                  >
                    <Icon name={KIND_ICON[w.targetKind] ?? 'search'} size="sm" className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-body font-bold', w.enabled ? 'text-fg' : 'text-muted line-through')}>{w.label}</span>
                      <span className="block text-caption text-muted">
                        {KINDS.find((k) => k.value === w.targetKind)?.label} · {cadenceLabel(w.cadence)} · {w.style === 'brief' ? 'Brief' : 'Detailed'}
                        {w.enabled ? '' : ' · Paused'}
                      </span>
                    </span>
                    <span className="text-caption font-bold text-link">Edit</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function WatchForm({ watch, initial, onDone }: { watch?: WatchSubscription; initial: WatchDraft; onDone: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<WatchDraft>(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const deals = useApi('getDeals', undefined, { enabled: d.targetKind === 'account' });
  const accounts = deals.data?.accounts ?? [];
  const accountName = d.targetKind === 'account' ? accounts.find((a) => a.id === d.target)?.name : undefined;
  const norm = useMemo(() => normaliseWatch(d, accountName), [d, accountName]);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const valid = !!norm;
  const patch = useOptimisticMutation({ route: 'patchWatch', topics: ['watches', 'briefs'], toast: (r) => ({ title: `Saved watch: ${r.entity.label}`, key: `watch:${r.entity.id}` }) });

  const save = async () => {
    if (!norm || state === 'saving') return;
    setState('saving');
    setError(null);
    try {
      if (watch) {
        await patch.mutateAsync({
          params: { id: watch.id },
          body: { ifVersion: watch.version, patch: { targetKind: d.targetKind, target: norm.target, label: norm.label, cadence: d.cadence, style: d.style, enabled: d.enabled } },
        });
      } else {
        const res = await api('createWatch', { body: { targetKind: d.targetKind, target: norm.target, label: norm.label, cadence: d.cadence, style: d.style } });
        toast({ key: `watch:${res.entity.id}`, title: `Watching ${res.entity.label}`, undo: res.auditId ? { auditId: res.auditId } : undefined });
        await Promise.all(['watches', 'briefs'].map((t) => qc.invalidateQueries({ queryKey: [t] })));
      }
      onDone();
    } catch (e) {
      setState('error');
      setError(e instanceof ApiError ? (e.code === 'conflict' ? 'This watch changed elsewhere. Cancel and reopen it to see the latest.' : e.message) : String(e));
    }
  };

  const fieldLabel = d.targetKind === 'search' ? 'Search' : d.targetKind === 'channel' ? 'Channel' : d.targetKind === 'account' ? 'Account' : d.targetKind === 'opp' ? 'Opportunity' : 'Person';
  return (
    <form
      aria-label={watch ? `Edit watch ${watch.label}` : 'Add watch'}
      data-testid="watch-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone();
        }
      }}
      className="grid gap-4"
    >
      <h3 className="text-body-lg font-bold text-fg-heading">{watch ? `Edit ${watch.label}` : 'New watch'}</h3>
      <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-x-6 gap-y-1">
        <span className="text-caption font-bold text-muted">What to watch</span>
        <SegmentedToggle label="Watch type" size="sm" value={d.targetKind} onChange={(k) => setD({ ...d, targetKind: k, target: '', label: '' })} options={KINDS} />
      </div>
      <label className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-x-6 gap-y-1">
        <span className="text-caption font-bold text-muted">{fieldLabel}</span>
        {d.targetKind === 'account' ? (
          <select
            data-autofocus
            value={d.target}
            onChange={(e) => setD({ ...d, target: e.target.value })}
            className="h-9 w-full max-w-[32rem] rounded-md border border-line-input bg-surface-input px-2 text-body text-fg focus:border-accent focus:outline-none"
          >
            <option value="">{deals.isLoading ? 'Loading accounts…' : PLACEHOLDER.account}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            data-autofocus
            autoFocus
            value={d.target}
            onChange={(e) => setD({ ...d, target: e.target.value })}
            placeholder={PLACEHOLDER[d.targetKind]}
            className="h-9 w-full max-w-[32rem] rounded-md border border-line-input bg-surface-input px-2.5 text-body text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
        )}
      </label>
      <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-x-6 gap-y-1">
        <span className="text-caption font-bold text-muted">How often</span>
        <SegmentedToggle label="Cadence" size="sm" value={d.cadence} onChange={(c) => setD({ ...d, cadence: c })} options={CADENCES} />
      </div>
      <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-x-6 gap-y-1">
        <span className="text-caption font-bold text-muted">Style</span>
        <div className="flex flex-wrap items-center gap-6">
          <SegmentedToggle
            label="Style"
            size="sm"
            value={d.style}
            onChange={(s) => setD({ ...d, style: s })}
            options={[
              { value: 'brief', label: 'Brief' },
              { value: 'detailed', label: 'Detailed' },
            ]}
          />
          {watch ? (
            <label className="flex h-8 items-center gap-2 text-body text-fg">
              <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} className="size-4 accent-[var(--color-accent)]" />
              On
            </label>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-body text-danger-700">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!valid || (!!watch && !dirty)} loading={state === 'saving'} data-testid="watch-save">
          Save
        </Button>
        <Button variant="quiet" size="sm" onClick={onDone} kbd="escape">
          Cancel
        </Button>
        <span className="ml-auto">
          <InlineStatus state={dirty ? (state === 'error' ? 'error' : state === 'saving' ? 'saving' : 'dirty') : 'idle'} error={error} onRetry={() => void save()} />
        </span>
      </div>
    </form>
  );
}
