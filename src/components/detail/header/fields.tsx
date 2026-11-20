'use client';
/**
 * Autosaved item fields (UI-SPEC §8: title, purpose, due, start by, effort, notes). Each field keeps
 * its own text while you type, saves ~1 s after you stop (and on blur / navigation), shows
 * InlineStatus beside it, and adopts server values only while you're not editing it.
 *
 * Fields register with the detail's FieldRegistry so a 409 "Changed elsewhere" banner can retry
 * (keep yours) or adopt (take theirs) exactly the conflicting fields.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Effort } from '@/contract';
import { useAutosave, type UseAutosaveResult } from '@/client/save';
import { Button, cn, FieldConflict, Icon, InlineStatus, Popover, type InlineStatusProps } from '@/ui';
import { mergeField } from '@/components/lists/live-merge';
import { fmtMin, parseMinutes } from '../lib/derive';
import { fmtWhen, fromLocalInput, toLocalInput, whenPresets } from '../lib/tz';

// ── Registry (409 → keep yours / take theirs) ───────────────────────────────────────────────

export interface FieldHandle {
  retry: () => void;
  adopt: (value: unknown) => void;
}

export type FieldRegistry = Map<string, FieldHandle>;
export const FieldRegistryContext = createContext<FieldRegistry | null>(null);

function useRegister(field: string, handle: FieldHandle) {
  const reg = useContext(FieldRegistryContext);
  const ref = useRef(handle);
  ref.current = handle;
  useEffect(() => {
    if (!reg) return;
    const h: FieldHandle = { retry: () => ref.current.retry(), adopt: (v) => ref.current.adopt(v) };
    reg.set(field, h);
    return () => {
      if (reg.get(field) === h) reg.delete(field);
    };
  }, [reg, field]);
}

/**
 * Server value → local value, but never while the field is being edited or has unsaved text (docs/UX.md "Live
 * updates"). Given the field's own text (`local`), it also reports a change made elsewhere while you edit: the value
 * it changed to (`theirs`), so the field can say "Changed elsewhere: keep mine / take theirs" before you save.
 */
function useAdopt<T>(server: T, focused: boolean, auto: UseAutosaveResult, setLocal: (v: T) => void, isEqual: (a: T, b: T) => boolean, last: { current: T }, local?: T): { theirs: T } | null {
  const busy = auto.state === 'dirty' || auto.state === 'saving' || auto.state === 'error';
  useEffect(() => {
    if (isEqual(last.current, server)) return;
    if (focused || busy) return; // re-checked when focus leaves or the save settles
    last.current = server;
    auto.reset(server);
    setLocal(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, focused, busy]);
  if (local === undefined || auto.state === 'saving') return null;
  const m = mergeField({ base: last.current, local, server, editing: focused || busy, equal: isEqual });
  return m.kind === 'conflict' ? { theirs: m.theirs } : null;
}

function statusOf(auto: UseAutosaveResult): InlineStatusProps {
  return auto.status;
}

/** Retry plus a quiet "Revert" when a save failed (the typed text stays so nothing is lost). */
function FieldStatus({ auto, onRevert, className }: { auto: UseAutosaveResult; onRevert?: () => void; className?: string }) {
  const s = statusOf(auto);
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} data-save-state={s.state}>
      <InlineStatus {...s} />
      {s.state === 'error' && onRevert ? (
        <button type="button" onClick={onRevert} className="rounded-sm text-caption text-muted hover:text-fg hover:underline focus-visible:shadow-focus focus-visible:outline-none">
          Revert
        </button>
      ) : null}
    </span>
  );
}

// ── Text fields ─────────────────────────────────────────────────────────────────────────────

/**
 * `basis` is the server value this edit started from. The detail compares it with the latest server value
 * before writing, so a change made elsewhere meanwhile surfaces as "Changed elsewhere" instead of being
 * silently overwritten (R-UI-20).
 */
export type FieldSave<T> = (value: T, basis: T) => Promise<unknown>;

export interface TextFieldProps {
  field: string;
  value: string | null;
  save: FieldSave<string | null>;
  label: string;
  placeholder?: string;
  /** Required fields (title) never save empty: emptying + blur reverts. */
  required?: boolean;
  multiline?: boolean;
  /**
   * One logical line that wraps to as many rows as it needs (a detail title, DESIGN-V2: "two lines in
   * detail views"). Enter still saves and leaves the field; newlines are never inserted.
   */
  wrap?: boolean;
  prefix?: ReactNode;
  className?: string;
  inputClassName?: string;
  /** Status position: inline after the input, or a separate line under it. */
  statusBelow?: boolean;
  inputRef?: React.Ref<HTMLInputElement & HTMLTextAreaElement>;
  maxLength?: number;
}

export function TextField({ field, value, save, label, placeholder, required, multiline, wrap, prefix, className, inputClassName, statusBelow, inputRef, maxLength = 500 }: TextFieldProps) {
  const server = value ?? '';
  const [text, setText] = useState(server);
  const [focused, setFocused] = useState(false);
  const id = useId();
  // Required + empty: present the server value to the saver, so nothing empty is ever written.
  const effective = required && !text.trim() ? server : text;
  const basis = useRef(server);
  const auto = useAutosave(
    effective,
    async (v) => {
      const r = await save(v.trim() ? v.trim() : null, basis.current || null);
      basis.current = v.trim();
      return r;
    },
    { debounceMs: 1000, isEqual: (a, b) => a.trim() === b.trim() },
  );
  const elsewhere = useAdopt(server, focused, auto, setText, (a, b) => a.trim() === b.trim(), basis, text);
  const keepMine = () => {
    basis.current = server; // seen theirs: the save writes yours over it
  };
  const takeTheirs = () => {
    basis.current = server;
    auto.reset(server);
    setText(server);
  };
  useRegister(field, {
    retry: () => void auto.retry(),
    adopt: (v) => {
      const s = typeof v === 'string' ? v.replace(/^For:\s*/i, '') : '';
      basis.current = s;
      auto.reset(s);
      setText(s);
    },
  });
  const revert = () => {
    auto.reset(server);
    setText(server);
  };

  const common = {
    id,
    value: text,
    placeholder,
    maxLength,
    'aria-label': label,
    'data-field': field,
    // A wrapped title stays one logical line: pasted newlines become spaces.
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(wrap ? e.target.value.replace(/\s*\n+\s*/g, ' ') : e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (required && !text.trim()) setText(server);
      auto.bind.onBlur();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        // Esc: drop unsaved text, then leave the field (a second Esc closes the sheet).
        if (auto.state === 'dirty') revert();
        (e.target as HTMLElement).blur();
        e.stopPropagation();
      } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      }
    },
    // One class per property and state (cn doesn't merge): the text color comes from inputClassName (inputs
    // inherit otherwise), and only multiline notes draw a resting border.
    className: cn(
      'min-w-0 w-full rounded-md border bg-transparent px-1 -mx-1 placeholder:text-faint transition-colors',
      multiline ? 'border-line' : 'border-transparent',
      'hover:border-line-strong focus:border-focus focus:bg-surface-input focus:shadow-[0_0_0_1px_var(--color-focus)] focus:outline-none',
      inputClassName,
    ),
  };

  return (
    <div className={cn(statusBelow ? 'flex flex-col gap-0.5' : 'flex min-w-0 items-center gap-2', className)}>
      <div className="flex min-w-0 flex-1 items-baseline gap-1">
        {prefix}
        {multiline ? (
          <textarea ref={inputRef} rows={3} {...common} className={cn(common.className, 'resize-y py-1')} />
        ) : wrap ? (
          <textarea ref={inputRef} rows={1} {...common} className={cn(common.className, 'field-sizing-content resize-none overflow-hidden py-0.5 text-balance')} />
        ) : (
          <input ref={inputRef} type="text" autoComplete="off" {...common} />
        )}
      </div>
      <FieldStatus auto={auto} onRevert={revert} className={statusBelow ? 'min-h-5' : 'shrink-0'} />
      {elsewhere ? <FieldConflict theirs={elsewhere.theirs} onKeepMine={keepMine} onTakeTheirs={takeTheirs} className={statusBelow ? undefined : 'basis-full'} /> : null}
    </div>
  );
}

// ── When (due / start by) ──────────────────────────────────────────────────────────────────

export interface WhenFieldProps {
  field: 'due' | 'startBy';
  label: string;
  value: string | null;
  save: FieldSave<string | null>;
  now: string;
  tz?: string;
  /** "late" styling relative to now. */
  emphasizeLate?: boolean;
  /** Caption size for the quiet v2 meta row. */
  compact?: boolean;
}

export function WhenField({ field, label, value, save, now, tz, emphasizeLate, compact }: WhenFieldProps) {
  const [local, setLocal] = useState<string | null>(value);
  const [open, setOpen] = useState(false);
  const basis = useRef(value);
  const auto = useAutosave(
    local,
    async (v) => {
      const r = await save(v, basis.current);
      basis.current = v;
      return r;
    },
    { debounceMs: 250 },
  );
  useAdopt(value, open, auto, setLocal, Object.is, basis);
  useRegister(field, {
    retry: () => void auto.retry(),
    adopt: (v) => {
      const s = typeof v === 'string' ? v : null;
      basis.current = s;
      auto.reset(s);
      setLocal(s);
    },
  });
  const late = emphasizeLate && local && Date.parse(local) < Date.parse(now);
  const pick = (iso: string | null) => {
    setLocal(iso);
    setOpen(false);
  };

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="bottom-start"
        width={264}
        label={`${label}: pick a time`}
        trigger={
          <button
            type="button"
            data-field={field}
            aria-label={`${label}: ${local ? fmtWhen(local, now, tz, { today: true }) : 'not set'}. Change`}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border border-transparent px-1.5 -mx-1.5 whitespace-nowrap tabular-nums transition-colors',
              compact ? 'h-7 text-caption' : 'h-7 text-body',
              'hover:border-line-strong hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none aria-expanded:border-focus',
              local ? (late ? 'font-bold text-danger-700' : 'text-fg') : 'text-faint',
            )}
          >
            <span>{local ? fmtWhen(local, now, tz, { today: true }) : 'Not set'}</span>
            <Icon name="chevrondown" size="xs" className="text-faint" />
          </button>
        }
      >
        <div className="p-2">
          <ul className="space-y-0.5">
            {whenPresets(now, tz).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => pick(p.at)}
                  className="flex h-7 w-full items-center justify-between rounded-md px-2 text-left text-body text-fg hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                >
                  {p.label}
                  <span className="text-caption text-muted tabular-nums">{fmtWhen(p.at, now, tz)}</span>
                </button>
              </li>
            ))}
          </ul>
          <label className="mt-2 block border-t border-line pt-2 text-caption text-muted">
            Exact time
            <input
              type="datetime-local"
              defaultValue={toLocalInput(local, tz)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const iso = fromLocalInput((e.target as HTMLInputElement).value, tz);
                  if (iso) pick(iso);
                }
              }}
              onBlur={(e) => {
                const iso = fromLocalInput(e.target.value, tz);
                if (iso && iso !== local) setLocal(iso);
              }}
              className="mt-1 h-9 w-full rounded-md border border-line-input bg-surface-input px-2 text-body text-fg focus:border-focus focus:outline-none"
            />
          </label>
          {local ? (
            <Button variant="ghost" size="xs" className="mt-2" icon="close" onClick={() => pick(null)}>
              Clear {label.toLowerCase()}
            </Button>
          ) : null}
        </div>
      </Popover>
      <FieldStatus auto={auto} />
    </span>
  );
}

// ── Effort (you · agent) ───────────────────────────────────────────────────────────────────

export interface EffortFieldProps {
  value: Effort;
  save: FieldSave<Effort>;
  /** Caption size for the quiet v2 meta row. */
  compact?: boolean;
}

const sameEffort = (a: Effort, b: Effort) => a.youMin === b.youMin && a.agentMin === b.agentMin;

export function EffortField({ value, save, compact }: EffortFieldProps) {
  const [local, setLocal] = useState<Effort>(value);
  const [open, setOpen] = useState(false);
  const [texts, setTexts] = useState({ you: fmtMin(value.youMin), agent: fmtMin(value.agentMin) });
  const basis = useRef(value);
  const auto = useAutosave(
    local,
    async (v) => {
      const r = await save(v, basis.current);
      basis.current = v;
      return r;
    },
    { debounceMs: 800, isEqual: sameEffort },
  );
  useAdopt(
    value,
    open,
    auto,
    (v) => {
      setLocal(v);
      setTexts({ you: fmtMin(v.youMin), agent: fmtMin(v.agentMin) });
    },
    sameEffort,
    basis,
  );
  useRegister('effort', {
    retry: () => void auto.retry(),
    adopt: (v) => {
      const e = (v as Effort | undefined) ?? value;
      basis.current = e;
      auto.reset(e);
      setLocal(e);
      setTexts({ you: fmtMin(e.youMin), agent: fmtMin(e.agentMin) });
    },
  });
  const set = (k: 'you' | 'agent', t: string) => {
    setTexts((s) => ({ ...s, [k]: t }));
    const m = parseMinutes(t);
    if (m === null) return;
    setLocal((e) => (k === 'you' ? { ...e, youMin: m } : { ...e, agentMin: m }));
  };
  const invalid = (t: string) => parseMinutes(t) === null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) void auto.flush();
        }}
        placement="bottom-start"
        width={240}
        label="Effort"
        trigger={
          <button
            type="button"
            data-field="effort"
            aria-label={`Effort: you ${fmtMin(local.youMin)}, agent ${fmtMin(local.agentMin)}. Change`}
            className={cn(
              '-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-1.5 whitespace-nowrap text-muted tabular-nums hover:border-line-strong hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none aria-expanded:border-focus',
              compact ? 'text-caption' : 'text-body',
            )}
          >
            you <span className="font-bold text-fg">{fmtMin(local.youMin)}</span>
            <span className="text-faint">·</span>
            {/* Agent time is its own background lane: violet marks it, and it never adds to yours. */}
            agent <span className="font-bold text-ai-700">{local.agentMin ? `~${fmtMin(local.agentMin)}` : '—'}</span>
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2 p-3">
          {(['you', 'agent'] as const).map((k) => (
            <label key={k} className="text-caption text-muted">
              {k === 'you' ? 'Your time' : 'Agent time'}
              <input
                value={texts[k]}
                onChange={(e) => set(k, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setOpen(false);
                    void auto.flush();
                  }
                }}
                aria-invalid={invalid(texts[k]) || undefined}
                placeholder="45m"
                className={cn(
                  'mt-1 h-9 w-full rounded-md border bg-surface-input px-2 text-body text-fg tabular-nums focus:outline-none',
                  invalid(texts[k]) ? 'border-danger-600' : 'border-line-input focus:border-focus',
                )}
              />
            </label>
          ))}
          <p className="col-span-2 text-caption text-muted">Agent time runs in the background and never counts against your day. Use 45m, 1h, 1h30.</p>
        </div>
      </Popover>
      <FieldStatus auto={auto} />
    </span>
  );
}
