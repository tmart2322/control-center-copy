'use client';
/**
 * Kit: the save model against the real mock API.
 * - Autosave: useAutosave + useOptimisticMutation(patchItem); "Fail saves" adds ?fail=1.
 * - Optimistic state change: itemAction done/snooze with Undo (POST /audit/:id/undo) and rollback.
 * - Concurrency: two editors on one item, each with its own stale version, to exercise the 409
 *   rebase (different fields) and the "Changed elsewhere" conflict (same field).
 */
import { useEffect, useRef, useState } from 'react';
import type { WorkItem } from '@/contract';
import { useApi } from '@/client/hooks';
import { useOptimisticMutation } from '@/client/optimistic/useOptimisticMutation';
import { rebaseFieldPatch } from '@/client/optimistic/rebase';
import { useAutosave } from '@/client/save/useAutosave';
import { Button, ChangedElsewhere, Eyebrow, InlineStatus, PanelError, Skeleton, StatePill, type Tone } from '@/ui';
import { KitSection, Specimen } from './frame';

const STATE_TONE: Partial<Record<WorkItem['state'], Tone>> = { done: 'ok', snoozed: 'neutral', in_progress: 'brand', waiting_on_me: 'warn', reopened: 'warn', likely_done: 'ai', suggested: 'ai' };

function FailToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex shrink-0 items-center gap-1.5 text-caption whitespace-nowrap text-muted">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-(--color-danger-600)" />
      Fail saves (?fail=1)
    </label>
  );
}

/** Pick an open item once (by list position), then follow it by id so it stays put after done/snooze. */
function usePinnedItem(index: number) {
  const items = useApi('listItems', { query: { tab: 'all_open' } });
  const [id, setId] = useState<string | null>(null);
  const candidate = items.data?.items[index]?.id;
  useEffect(() => {
    if (!id && candidate) setId(candidate);
  }, [id, candidate]);
  const detail = useApi('getItem', { params: { id: id ?? '' } }, { enabled: Boolean(id) });
  return { item: detail.data?.item, error: items.error ?? detail.error, refetch: () => Promise.all([items.refetch(), detail.refetch()]) };
}

const inputCls =
  'h-8 w-full min-w-0 rounded-md border border-line-input bg-surface px-2.5 text-body text-fg outline-none focus:border-brand-600 focus:shadow-[0_0_0_1px_var(--color-brand-600)] comfortable:h-9';

function AutosaveEditor({ item, cached }: { item: WorkItem; cached?: WorkItem }) {
  const [title, setTitle] = useState(item.title);
  const [fail, setFail] = useState(false);
  const failRef = useRef(fail);
  failRef.current = fail;
  const patch = useOptimisticMutation({
    route: 'patchItem',
    fail: () => failRef.current,
    optimistic: (input, cache) => cache.patchEntity(input.params!.id, (e) => ({ ...e, ...input.body!.patch })),
  });
  const autosave = useAutosave(title, (v) => patch.mutateAsync({ params: { id: item.id }, body: { ifVersion: patch.versionOf(item.id) ?? item.version, patch: { title: v } } }));
  return (
    <div className="w-full max-w-xl space-y-2" data-autosave-item={item.id}>
      <div className="flex items-center gap-3">
        <label htmlFor="kit-autosave" className="w-14 shrink-0 text-caption text-muted">
          Title
        </label>
        <input id="kit-autosave" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} {...autosave.bind} />
        <InlineStatus {...autosave.status} className="w-36 shrink-0" />
      </div>
      <div className="flex items-center gap-3 pl-[4.25rem] text-caption text-muted">
        <FailToggle value={fail} onChange={setFail} />
        <span className="min-w-0 truncate">
          Cache (what other views show): <span className="text-fg">{cached?.title ?? '…'}</span> · v{cached?.version ?? '?'}
        </span>
      </div>
    </div>
  );
}

export function AutosaveDemo() {
  const { item, error, refetch } = usePinnedItem(0);
  return (
    <Specimen label="Autosave" note="1 s debounce · blur · navigation; edits roll back in the cache on failure but your text stays">
      {item ? <AutosaveEditor key={item.id} item={item} cached={item} /> : error ? <PanelError compact error={error} onRetry={() => void refetch()} /> : <Skeleton count={2} className="w-96" />}
    </Specimen>
  );
}

export function OptimisticDemo() {
  const { item } = usePinnedItem(1);
  const [fail, setFail] = useState(false);
  const failRef = useRef(fail);
  failRef.current = fail;
  const action = useOptimisticMutation({
    route: 'itemAction',
    fail: () => failRef.current,
    optimistic: (input, cache) => cache.patchEntity(input.params!.id, (e) => ({ ...e, state: input.params!.verb === 'done' ? 'done' : 'snoozed' })),
    toast: (res, input) => ({ title: `${input.params!.verb === 'done' ? 'Done' : 'Snoozed'}: ${res.entity.title}` }),
  });
  const shown = item;
  const run = (verb: 'done' | 'snooze') => {
    if (!shown) return;
    action.mutate({ params: { id: shown.id, verb }, body: { ifVersion: action.versionOf(shown.id) ?? shown.version, until: verb === 'snooze' ? new Date(Date.now() + 3600_000).toISOString() : undefined } });
  };
  return (
    <Specimen label="Optimistic state change" note="instant, Undo toast (audit), rollback + Retry on failure">
      {shown ? (
        <div className="flex w-full max-w-xl flex-wrap items-center gap-3" data-item-id={shown.id}>
          <span className="min-w-0 flex-1 truncate text-body font-bold">{shown.title}</span>
          <StatePill tone={STATE_TONE[shown.state] ?? 'neutral'} label={shown.state.replace(/_/g, ' ')} />
          <Button size="xs" variant="secondary" icon="check" kbd="d" onClick={() => run('done')} disabled={shown.state === 'done'}>
            Done
          </Button>
          <Button size="xs" variant="secondary" icon="clock" kbd="s" onClick={() => run('snooze')} disabled={shown.state === 'snoozed'}>
            Snooze 1 h
          </Button>
          <InlineStatus {...action.inlineStatus} />
          <div className="basis-full">
            <FailToggle value={fail} onChange={setFail} />
          </div>
        </div>
      ) : (
        <Skeleton count={1} className="w-96" />
      )}
    </Specimen>
  );
}

type Field = 'title' | 'notes';

function Editor({ name, item, hint }: { name: string; item: WorkItem; hint: string }) {
  const base = useRef<WorkItem>(item);
  const [vals, setVals] = useState<Record<Field, string>>({ title: item.title, notes: item.notes ?? '' });
  const [note, setNote] = useState<string | null>(null);
  const m = useOptimisticMutation({
    route: 'patchItem',
    rebase: ({ input, current }) => {
      const r = rebaseFieldPatch(base.current as unknown as Record<string, unknown>, current, input.body!.patch as Record<string, unknown>);
      return r.ok ? { ...input, body: { ...input.body!, ifVersion: r.ifVersion } } : null;
    },
    onSuccess: (res) => {
      const was = base.current.version;
      base.current = res.entity;
      setNote(res.entity.version > was + 1 ? `Rebased onto v${res.entity.version - 1}, saved v${res.entity.version}` : `Saved v${res.entity.version}`);
    },
  });
  const save = (f: Field) => {
    setNote(null);
    m.mutate({ params: { id: item.id }, body: { ifVersion: base.current.version, patch: { [f]: vals[f] } } });
  };
  return (
    <div className="min-w-0 flex-1 space-y-2 rounded-md border border-line p-3">
      <div className="flex items-center gap-2">
        <Eyebrow>{name}</Eyebrow>
        <span className="text-caption text-muted">editing from v{base.current.version}</span>
        <span className="ml-auto text-caption text-faint">{hint}</span>
      </div>
      {(['title', 'notes'] as Field[]).map((f) => (
        <div key={f} className="flex items-center gap-2">
          <label className="w-10 shrink-0 text-caption text-muted" htmlFor={`kit-${name}-${f}`}>
            {f}
          </label>
          <input id={`kit-${name}-${f}`} className={inputCls} value={vals[f]} onChange={(e) => setVals((v) => ({ ...v, [f]: e.target.value }))} />
          <Button size="xs" variant="secondary" onClick={() => save(f)} loading={m.isPending}>
            Save
          </Button>
        </div>
      ))}
      <div className="min-h-5 text-caption">
        {m.conflict ? (
          <ChangedElsewhere
            fields={m.conflict.fields}
            onKeepMine={() => m.conflict?.keepMine()}
            onTakeTheirs={() => {
              const theirs = m.conflict!.theirs as unknown as WorkItem;
              base.current = theirs;
              setVals({ title: theirs.title, notes: theirs.notes ?? '' });
              m.conflict?.takeTheirs();
              setNote(`Took theirs (v${theirs.version})`);
            }}
          />
        ) : m.error ? (
          <InlineStatus {...m.inlineStatus} />
        ) : note ? (
          <span className="text-success-700">{note}</span>
        ) : null}
      </div>
    </div>
  );
}

export function ConcurrencyDemo() {
  const { item, refetch } = usePinnedItem(2);
  const [round, setRound] = useState(0);
  return (
    <Specimen label="409 rebase and conflict" note="1) A saves notes  2) B saves title from its stale version → silent rebase  3) A saves title → Changed elsewhere">
      {item ? (
        <div className="w-full space-y-2" key={`${item.id}-${round}`}>
          <div className="flex gap-3 @max-5xl/main:flex-col">
            <Editor name="Editor A" item={item} hint="you, tab 1" />
            <Editor name="Editor B" item={item} hint="you, tab 2 (or an engine)" />
          </div>
          <Button size="xs" variant="ghost" icon="refresh" onClick={() => {
            void refetch().then(() => setRound((r) => r + 1));
          }}>
            Reload both from the server
          </Button>
        </div>
      ) : (
        <Skeleton count={2} className="w-96" />
      )}
    </Specimen>
  );
}

export function SaveSection() {
  return (
    <KitSection id="save" eyebrow="Save model" title="Autosave, optimistic changes, 409s" intro="Uses the mock API for real: changes write to the in-memory store. The dev toolbar's failure rate also applies.">
      <AutosaveDemo />
      <OptimisticDemo />
      <ConcurrencyDemo />
    </KitSection>
  );
}
