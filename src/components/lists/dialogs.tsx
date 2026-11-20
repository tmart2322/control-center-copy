'use client';
/**
 * Short blocking pickers for the Work list (UI-SPEC §2: modals only for quick, blocking moments):
 * snooze presets (keys 1-3) and the ⇧D resolve picker. Esc cancels and focus returns to the row.
 */
import { useId, type KeyboardEvent, type ReactNode } from 'react';
import type { PersonRef, WorkItem } from '@/contract';
import { ResolvePicker, type ResolveValue } from '@/components/domain';
import { Kbd, Overlay } from '@/ui';
import { snoozePresets } from './time';

export function SnoozeDialog({ open, title, now, tz, onPick, onClose }: { open: boolean; title: string; now: string; tz?: string; onPick: (until: string) => void; onClose: () => void }) {
  const id = useId();
  const presets = snoozePresets(now, tz);
  const onKeyDown = (e: KeyboardEvent) => {
    const n = Number(e.key);
    if (n >= 1 && n <= presets.length && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onPick(presets[n - 1]!.until);
    }
  };
  return (
    <Overlay open={open} onClose={onClose} labelledBy={id} className="p-4">
      <div onKeyDown={onKeyDown} className="w-[22rem] max-w-[90vw]">
        <h2 id={id} className="truncate text-title text-fg-heading">
          Snooze: {title}
        </h2>
        <p className="mt-0.5 text-caption text-muted">It comes back on its own. You can also snooze to a time in the item.</p>
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-md border border-line">
          {presets.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                data-autofocus={i === 0 ? '' : undefined}
                onClick={() => onPick(p.until)}
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-body text-fg hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]"
              >
                <Kbd>{i + 1}</Kbd>
                <span className="font-bold">{p.label}</span>
                <span className="ml-auto text-caption text-muted tabular-nums">{p.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Overlay>
  );
}

/** Who is on the thread: owner, counterparty and the people the item names. */
export function peopleOf(item: WorkItem): PersonRef[] {
  const seen = new Set<string>();
  const out: PersonRef[] = [];
  for (const p of [item.counterparty, item.owner, ...item.people]) {
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

export function ResolveDialog({
  item,
  related,
  onResolve,
  onClose,
}: {
  item: WorkItem | null;
  related: Array<{ id: string; title: string }>;
  onResolve: (v: ResolveValue) => void;
  onClose: () => void;
}): ReactNode {
  const people = item ? peopleOf(item) : [];
  return (
    <Overlay open={!!item} onClose={onClose} labelledBy={undefined} className="p-0">
      {item ? (
        <ResolvePicker
          title={item.title}
          people={people}
          threadPeople={people.map((p) => p.id)}
          relatedItems={related.filter((r) => r.id !== item.id)}
          onResolve={onResolve}
          onCancel={onClose}
          className="border-0 shadow-none"
        />
      ) : null}
    </Overlay>
  );
}
