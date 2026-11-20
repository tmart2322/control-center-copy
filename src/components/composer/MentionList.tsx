'use client';
/** The @-mention suggestion list. Only candidates that resolve to a real id for this destination are pickable. */
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { MentionCandidate } from './destination';
import { cx } from './_bits';

export interface MentionListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

export interface MentionListProps {
  items: MentionCandidate[];
  command: (attrs: { id: string; label: string; kind: string; email?: string }) => void;
  query: string;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList({ items, command, query }, ref) {
  const pickable = items.map((it, i) => (it.unresolved ? -1 : i)).filter((i) => i >= 0);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query, items.length]);

  const choose = (i: number) => {
    const it = items[i];
    if (!it || it.unresolved) return;
    command({ id: it.id, label: it.label, kind: it.kind, ...(it.email ? { email: it.email } : {}) });
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: (e: KeyboardEvent) => {
      // Nothing to pick: let Enter type a newline (and close the list) instead of trapping it.
      if (!pickable.length) return false;
      const pos = Math.max(0, pickable.indexOf(pickable[active] ?? pickable[0]!));
      if (e.key === 'ArrowDown') {
        setActive((pos + 1) % pickable.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        setActive((pos - 1 + pickable.length) % pickable.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        choose(pickable[pos]!);
        return true;
      }
      return false;
    },
  }));

  const activeIndex = pickable[active] ?? -1;
  return (
    <div role="listbox" aria-label="Mention someone" className="w-72 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-pop">
      {items.length === 0 ? (
        <p className="px-3 py-2 text-caption text-muted">No one on this work matches “{query}”.</p>
      ) : (
        items.map((it, i) => (
          <button
            key={`${it.kind}:${it.id}`}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            aria-disabled={it.unresolved ? true : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(i);
            }}
            className={cx(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-body',
              i === activeIndex ? 'bg-selected' : 'hover:bg-surface-muted',
              it.unresolved && 'cursor-not-allowed text-faint',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'grid size-5 shrink-0 place-items-center rounded-sm text-micro font-bold',
                it.unresolved ? 'bg-surface-sunken text-muted' : it.kind === 'special' ? 'bg-warning-50 text-warning-700' : 'bg-surface-sunken text-fg',
              )}
            >
              {it.kind === 'special' ? '@' : it.label.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate">{it.kind === 'special' ? `@${it.label}` : it.label}</span>
            <span className="shrink-0 truncate text-caption text-muted">{it.unresolved ?? it.detail ?? ''}</span>
          </button>
        ))
      )}
    </div>
  );
});
