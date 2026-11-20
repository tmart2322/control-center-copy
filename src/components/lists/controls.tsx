'use client';
/**
 * Small shared controls for the list pages (v2): a search field, a filter chip (a menu of radios), and the
 * "n new ↓" marker for rows that arrived while you were looking. Input-well surfaces, 10 px radii, no
 * pills; an active filter is the `selected` tint with an accent hairline (selection is blue).
 */
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn, Icon, Menu, type MenuEntry } from '@/ui';

export const SearchField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void }>(function SearchField(
  { className, value, onClear, ...rest },
  ref,
) {
  return (
    <label
      className={cn(
        'flex h-9 w-72 min-w-0 items-center gap-2 rounded-md border border-line-strong bg-surface-input px-3 text-body focus-within:border-focus focus-within:shadow-focus',
        className,
      )}
    >
      <Icon name="search" size="sm" className="shrink-0 text-muted" />
      <input
        ref={ref}
        type="search"
        value={value}
        className="min-w-0 flex-1 bg-transparent text-body text-fg placeholder:text-faint focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={onClear} className="grid size-6 place-items-center rounded-sm text-muted hover:text-fg focus-visible:outline-none focus-visible:shadow-focus">
          <Icon name="close" size="xs" />
        </button>
      ) : (
        <kbd className="rounded-sm border border-line bg-surface-sunken px-1.5 font-mono text-micro text-muted">/</kbd>
      )}
    </label>
  );
});

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterChipProps {
  label: string;
  value: string | null;
  options: FilterOption[];
  anyLabel?: string;
  onChange: (value: string | null) => void;
  /** Width of the menu. */
  width?: number;
}

/** "Account ▾" / "Account: ACME ▾". A radio menu with an "Any" row. */
export function FilterChip({ label, value, options, anyLabel = 'Any', onChange, width = 260 }: FilterChipProps) {
  const current = options.find((o) => o.value === value);
  const shown = value ? (current?.label ?? value) : null;
  const items: MenuEntry[] = [
    { type: 'radio', id: '__any', label: anyLabel, checked: !value, onSelect: () => onChange(null) },
    { type: 'separator' },
    ...options.map((o): MenuEntry => ({ type: 'radio', id: o.value, label: o.label, checked: o.value === value, onSelect: () => onChange(o.value) })),
  ];
  return (
    <Menu
      label={label}
      width={width}
      placement="bottom-start"
      items={items}
      trigger={
        <button
          type="button"
          aria-label={shown ? `${label}: ${shown}` : label}
          data-active={shown ? '' : undefined}
          className={cn(
            'inline-flex h-9 max-w-64 items-center gap-1.5 rounded-md border px-3 text-body transition-colors focus-visible:outline-none focus-visible:shadow-focus',
            shown ? 'border-accent bg-selected text-fg-heading' : 'border-line-strong bg-surface text-fg hover:bg-surface-muted',
          )}
        >
          <span className={shown ? 'text-fg' : 'text-muted'}>{label}</span>
          {shown ? <span className="min-w-0 truncate font-bold">{shown}</span> : null}
          <Icon name="chevrondown" size="xs" className="text-muted" />
        </button>
      }
    />
  );
}

// "N new below" (NewBelow) is gone: arrivals now enter at their place, or wait behind <LivePill> (src/ui/Live.tsx,
// docs/UX.md "Live updates").
