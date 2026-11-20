'use client';
/**
 * ResolvePicker (⇧D, R-UI-22, UI-SPEC §11): reason chips + a person picker for "Handed off" / "Done by
 * someone else" (people on the thread first) + an item picker for Duplicate / Superseded. A hand-off sets
 * my involvement to Watcher (default) or Not involved. Keys: 1–7 pick a reason, Enter resolves, Esc cancels.
 * Emits exactly the ItemActionRequest fields for `POST /items/:id/actions/resolve`.
 * DESIGN-V2: sentence-case labels, square-ish chips, selection = accent border + selected fill; Resolve is
 * the one filled button.
 */
import type { PersonRef, Resolution } from '@/contract';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, cn, Icon, initials, Kbd } from '@/ui';
import { RESOLUTION_LABEL } from './vocab';

export interface ResolveValue {
  resolution: Resolution;
  detail?: { personId?: string; personName?: string; relatedItemId?: string; note?: string };
  involvement?: 'watcher' | 'not_involved' | 'contributor';
}

export interface ResolvePickerProps {
  /** Everyone the picker can name; `threadPeople` are listed first ("on the thread"). */
  people: PersonRef[];
  threadPeople?: string[];
  /** Candidates for Duplicate of / Superseded by. */
  relatedItems?: Array<{ id: string; title: string }>;
  defaultResolution?: Resolution;
  title?: string;
  className?: string;
  onResolve?: (value: ResolveValue) => void;
  onCancel?: () => void;
}

const ORDER: Resolution[] = ['done_by_me', 'handed_off', 'done_by_other', 'not_needed', 'duplicate', 'declined', 'superseded'];
const NEEDS_PERSON = new Set<Resolution>(['handed_off', 'done_by_other']);
const NEEDS_ITEM = new Set<Resolution>(['duplicate', 'superseded']);

export function ResolvePicker({ people, threadPeople = [], relatedItems = [], defaultResolution = 'done_by_me', title, className, onResolve, onCancel }: ResolvePickerProps) {
  const [resolution, setResolution] = useState<Resolution>(defaultResolution);
  const [q, setQ] = useState('');
  const [personId, setPersonId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [involvement, setInvolvement] = useState<'watcher' | 'not_involved'>('watcher');
  const [note, setNote] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const personInput = useRef<HTMLInputElement>(null);
  const pick = (r: Resolution) => {
    setResolution(r);
    if (NEEDS_PERSON.has(r)) requestAnimationFrame(() => personInput.current?.focus());
  };

  const ranked = useMemo(() => {
    const onThread = new Set(threadPeople);
    const list = people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.role?.toLowerCase().includes(q.toLowerCase()));
    return [...list.filter((p) => onThread.has(p.id)), ...list.filter((p) => !onThread.has(p.id))].slice(0, 6);
  }, [people, threadPeople, q]);

  const person = people.find((p) => p.id === personId) ?? null;
  const ready = NEEDS_PERSON.has(resolution) ? !!person || !!q.trim() : NEEDS_ITEM.has(resolution) ? !!itemId : true;

  const submit = () => {
    if (!ready) return;
    const detail: ResolveValue['detail'] = {};
    if (NEEDS_PERSON.has(resolution)) {
      if (person) {
        detail.personId = person.id;
        detail.personName = person.name;
      } else detail.personName = q.trim();
    }
    if (NEEDS_ITEM.has(resolution) && itemId) detail.relatedItemId = itemId;
    if (note.trim()) detail.note = note.trim();
    onResolve?.({ resolution, detail: Object.keys(detail).length ? detail : undefined, involvement: resolution === 'handed_off' ? involvement : undefined });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const inField = (e.target as HTMLElement).matches('input');
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel?.();
    } else if (e.key === 'Enter' && !(e.target as HTMLElement).matches('button')) {
      e.preventDefault();
      submit();
    } else if (!inField && /^[1-7]$/.test(e.key)) {
      pick(ORDER[Number(e.key) - 1]!);
    }
  };

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={title ?? 'Resolve'}
      onKeyDown={onKeyDown}
      className={cn('w-[30rem] rounded-xl border border-line bg-surface-overlay p-5 shadow-pop', className)}
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-body-lg font-bold text-fg-heading">{title ? `Resolve: ${title}` : 'Resolve'}</h3>
        <Kbd>⇧D</Kbd>
      </div>
      <p className="mt-3 text-caption font-bold text-muted">How was it resolved?</p>
      <div role="radiogroup" aria-label="Resolution" className="mt-1.5 flex flex-wrap gap-1.5">
        {ORDER.map((r, i) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={resolution === r}
            onClick={() => pick(r)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-body',
              resolution === r ? 'border-accent bg-selected font-bold text-fg-heading' : 'border-line-input bg-surface text-fg hover:bg-surface-muted',
            )}
          >
            <span className="text-micro text-faint tabular-nums">{i + 1}</span>
            {r === 'done_by_other' ? 'Done by someone else' : r === 'not_needed' ? 'No longer needed' : RESOLUTION_LABEL[r].replace('Done by you', 'Done by me')}
          </button>
        ))}
      </div>

      {NEEDS_PERSON.has(resolution) ? (
        <div className="mt-4">
          <p className="text-caption font-bold text-muted">{resolution === 'handed_off' ? 'Handed off to' : 'Done by'}</p>
          <div className="mt-1.5 flex h-10 items-center gap-2 rounded-md border border-line-input bg-surface-input px-3 focus-within:border-accent">
            <Icon name="search" size="xs" className="text-muted" />
            <input
              ref={personInput}
              value={person ? person.name : q}
              onChange={(e) => {
                setPersonId(null);
                setQ(e.target.value);
              }}
              placeholder="Search people…"
              aria-label="Person"
              className="min-w-0 flex-1 bg-transparent text-body placeholder:text-faint focus:outline-none"
            />
            {person ? (
              <button type="button" aria-label="Clear" onClick={() => setPersonId(null)} className="text-muted hover:text-fg">
                <Icon name="close" size="xs" />
              </button>
            ) : null}
          </div>
          {!person ? (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-line">
              {ranked.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setPersonId(p.id)} className="flex h-10 w-full items-center gap-2.5 px-3 text-left hover:bg-surface-muted">
                    <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-sunken text-micro font-bold text-fg">
                      {initials(p.name)}
                    </span>
                    <span className="truncate text-body text-fg">{p.name}</span>
                    <span className="truncate text-caption text-muted">{p.role}</span>
                    {threadPeople.includes(p.id) ? <span className="ml-auto shrink-0 text-caption text-faint">on the thread</span> : null}
                  </button>
                </li>
              ))}
              {!ranked.length ? <li className="px-2 py-1.5 text-caption text-muted">No match. Enter keeps “{q}” as the name.</li> : null}
            </ul>
          ) : null}
          {resolution === 'handed_off' ? (
            <div className="mt-2.5 flex items-center gap-2 text-caption">
              <span className="text-muted">Afterwards I am</span>
              {(['watcher', 'not_involved'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={involvement === v}
                  onClick={() => setInvolvement(v)}
                  className={cn('h-8 rounded-md border px-2.5', involvement === v ? 'border-accent bg-selected font-bold text-fg-heading' : 'border-line text-fg hover:bg-surface-muted')}
                >
                  {v === 'watcher' ? 'Watching' : 'Not involved'}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {NEEDS_ITEM.has(resolution) ? (
        <div className="mt-4">
          <p className="text-caption font-bold text-muted">{resolution === 'duplicate' ? 'Duplicate of' : 'Superseded by'}</p>
          <ul className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-line">
            {relatedItems.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  aria-pressed={itemId === it.id}
                  onClick={() => setItemId(it.id)}
                  className={cn('flex h-10 w-full items-center gap-2.5 px-3 text-left text-body', itemId === it.id ? 'bg-selected font-bold text-fg-heading' : 'hover:bg-surface-muted')}
                >
                  <Icon name={itemId === it.id ? 'check' : 'task'} size="xs" className={itemId === it.id ? 'text-link' : 'text-faint'} />
                  <span className="truncate">{it.title}</span>
                </button>
              </li>
            ))}
            {!relatedItems.length ? <li className="px-2 py-1.5 text-caption text-muted">No related items found.</li> : null}
          </ul>
        </div>
      ) : null}

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        aria-label="Note"
        className="mt-4 h-10 w-full rounded-md border border-line-input bg-surface-input px-3 text-body placeholder:text-faint focus:border-accent focus:outline-none"
      />
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="secondary" size="md" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="md" kbd="enter" disabled={!ready} onClick={submit}>
          Resolve
        </Button>
      </div>
    </div>
  );
}
