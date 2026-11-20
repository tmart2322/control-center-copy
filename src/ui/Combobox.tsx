'use client';
/**
 * Combobox (v2): a field-shaped trigger that opens an anchored search box over a listbox. Type to filter (the
 * caller filters and orders `options` for `query`, top match first), ↓ / ↑ move, Enter picks, Esc closes and gives
 * the trigger its focus back; on the closed trigger ↓ opens it and a typed letter opens it with that letter. The
 * keyboard is a pure step (combobox-model.ts). ARIA: the input is role=combobox with aria-activedescendant, the
 * list role=listbox, each option role=option (aria-selected = the active one, a check = the current value).
 * Options may carry a `group` (a quiet header where the group changes) and `disabled`. Built on Popover (portaled,
 * outside click closes, a modal key scope so page shortcuts don't fire behind it).
 */
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';
import { comboKey, comboTriggerKey, firstEnabled } from './combobox-model';
import { Icon } from './Icon';
import { Popover } from './Popover';

export interface ComboboxOption {
  key: string;
  /** Plain text: the accessible name and the default rendering. */
  label: string;
  disabled?: boolean;
  /** A quiet header is shown above the first option of each group (options without a group get none). */
  group?: string;
}

export interface ComboboxProps<T extends ComboboxOption> {
  /** Accessible name of the field, the search box and the list. */
  label: string;
  /** What the closed field shows (the current value, or a prompt). */
  value: ReactNode;
  options: T[];
  query: string;
  onQueryChange: (q: string) => void;
  /** Return 'keep' to stay open (an action that loads more options in place). */
  onPick: (o: T) => void | 'keep';
  /** The current value's key: checked in the list, and where the cursor starts when nothing is typed. */
  selectedKey?: string | null;
  /** Put the cursor here when the list changes (e.g. the first result of a search that just arrived). */
  activeKey?: string | null;
  renderOption?: (o: T, s: { active: boolean; selected: boolean }) => ReactNode;
  placeholder?: string;
  disabled?: boolean;
  triggerClassName?: string;
  title?: string;
  /** Popover width (default 30rem). */
  width?: number | string;
  /** A line under the list (loading, a search in flight, notes). */
  status?: ReactNode;
  /** Shown when there are no options. */
  empty?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  /** Focus on the closed trigger, or the pointer resting on it (150 ms): prefetch what the list needs. */
  onIntent?: () => void;
  'data-testid'?: string;
}

export function Combobox<T extends ComboboxOption>({
  label,
  value,
  options,
  query,
  onQueryChange,
  onPick,
  selectedKey = null,
  activeKey = null,
  renderOption,
  placeholder,
  disabled,
  triggerClassName,
  title,
  width = '30rem',
  status,
  empty,
  onOpenChange,
  onIntent,
  'data-testid': testId,
}: ComboboxProps<T>) {
  const [open, setOpenState] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const listId = `${id}-list`;
  const optId = (i: number) => `${id}-opt-${i}`;
  const disabledOf = options.map((o) => !!o.disabled);

  const startIndex = () => {
    const prefer = activeKey ?? (query.trim() ? null : selectedKey);
    const at = prefer ? options.findIndex((o) => o.key === prefer && !o.disabled) : -1;
    return at >= 0 ? at : firstEnabled(disabledOf);
  };
  // the cursor resets when the list changes (typing, results arriving) or the combobox opens
  const sig = `${open ? 1 : 0}|${activeKey ?? ''}|${options.map((o) => o.key).join('|')}`;
  const [seen, setSeen] = useState(sig);
  const [active, setActive] = useState(startIndex);
  if (seen !== sig) {
    setSeen(sig);
    setActive(startIndex());
  }

  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
    if (!v) onQueryChange('');
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => trigger.current?.focus());
  };
  const pick = (o: T | undefined) => {
    if (!o || o.disabled) return;
    if (onPick(o) === 'keep') return;
    close(true);
  };

  useLayoutEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const step = comboKey(e, active, disabledOf);
    if (step.kind === 'none') return;
    e.preventDefault();
    e.stopPropagation(); // the row, the page's j/k and the popover's own Esc never see it
    if (step.kind === 'move') setActive(step.active);
    else if (step.kind === 'pick') pick(options[step.index]);
    else close(true);
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (open || disabled) return;
    const t = comboTriggerKey(e);
    if (!t.open) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
    if (t.query) onQueryChange(t.query);
  };

  let lastGroup: string | undefined;
  return (
    <Popover
      open={open}
      onOpenChange={(v) => setOpen(v)}
      role="dialog"
      label={label}
      width={width}
      placement="bottom-start"
      className="overflow-hidden"
      trigger={
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          title={title}
          disabled={disabled}
          data-testid={testId}
          onKeyDown={onTriggerKey}
          onPointerEnter={() => {
            if (onIntent && !dwell.current) dwell.current = setTimeout(onIntent, 150);
          }}
          onPointerLeave={() => {
            if (dwell.current) clearTimeout(dwell.current);
            dwell.current = null;
          }}
          onFocus={onIntent}
          className={cn('flex items-center gap-1 text-left', triggerClassName)}
        >
          <span className="min-w-0 flex-1 truncate">{value}</span>
          {disabled ? null : <Icon name="chevrondown" size="xs" className="shrink-0 text-faint" />}
        </button>
      }
    >
      {/* portaled, but React events still bubble to the row: clicks and keys in here are the combobox's own */}
      <div data-combobox={testId ?? ''} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-line px-3">
          <Icon name="search" size="sm" className="text-muted" />
          <input
            data-autofocus
            role="combobox"
            aria-label={label}
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && active < options.length ? optId(active) : undefined}
            value={query}
            placeholder={placeholder}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onInputKey}
            className="min-w-0 flex-1 bg-transparent text-body text-fg placeholder:text-faint focus:outline-none"
          />
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="cc-scroll max-h-80 overflow-y-auto py-1">
          {options.map((o, i) => {
            const header = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            const isActive = i === active;
            const selected = o.key === selectedKey;
            return [
              header ? (
                <li key={`g:${o.group}`} role="presentation" className={cn('px-3 pt-2 pb-1 text-micro font-bold tracking-wide text-faint uppercase', i > 0 && 'mt-1 border-t border-line')}>
                  {header}
                </li>
              ) : null,
              <li
                key={o.key}
                id={optId(i)}
                data-index={i}
                role="option"
                aria-selected={isActive}
                aria-disabled={o.disabled || undefined}
                data-current={selected ? '' : undefined}
                onMouseMove={() => !o.disabled && active !== i && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
                className={cn('flex min-h-10 cursor-default items-center gap-2 px-3 py-1.5 text-body', o.disabled ? 'text-faint' : isActive ? 'bg-selected' : 'hover:bg-surface-muted')}
              >
                {renderOption ? renderOption(o, { active: isActive, selected }) : <span className="min-w-0 flex-1 truncate text-fg">{o.label}</span>}
                {selected ? <Icon name="check" size="xs" className="shrink-0 text-link" title="Current" /> : null}
              </li>,
            ];
          })}
          {!options.length && empty ? (
            <li role="presentation" className="px-3 py-2 text-caption text-muted">
              {empty}
            </li>
          ) : null}
        </ul>
        {status ? <div className="border-t border-line px-3 py-2 text-caption text-muted">{status}</div> : null}
      </div>
    </Popover>
  );
}
