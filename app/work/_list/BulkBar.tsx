'use client';
/**
 * The batch bar (UI-SPEC §8): appears at the top of the list when rows are picked with `x` or a section's
 * "Select". You choose an operation, configure it, then press Apply (⌘↵). Nothing happens on selection
 * alone; Apply is explicit and one Undo covers the batch. Apply is the bar's one filled button.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useKeyBinding } from '@/client/keyboard';
import { BULK_RESOLUTIONS, type BulkOp } from '@/components/lists/bulk';
import { FilterChip } from '@/components/lists/controls';
import { snoozePresets } from '@/components/lists/time';
import { Button, cn, SegmentedToggle } from '@/ui';

type OpKind = BulkOp['kind'];

export interface BulkBarProps {
  count: number;
  total: number;
  initiatives: Array<{ id: string; label: string }>;
  now: string;
  tz?: string;
  busy: boolean;
  onApply: (op: BulkOp) => void;
  onClear: () => void;
  onSelectAll: () => void;
}

function Choice({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-body focus-visible:outline-none focus-visible:shadow-focus',
        checked ? 'border-accent bg-surface text-fg-heading' : 'border-line-strong bg-surface text-fg hover:bg-surface-muted',
      )}
    >
      {children}
    </button>
  );
}

export function BulkBar({ count, total, initiatives, now, tz, busy, onApply, onClear, onSelectAll }: BulkBarProps) {
  const [kind, setKind] = useState<OpKind>('done');
  const presets = useMemo(() => snoozePresets(now, tz), [now, tz]);
  const [snooze, setSnooze] = useState<string | null>(null);
  const [resolution, setResolution] = useState<(typeof BULK_RESOLUTIONS)[number]['value']>('done_by_me');
  const [move, setMove] = useState<string | null | undefined>(undefined); // undefined = not chosen; null = no initiative

  const op: BulkOp | null =
    kind === 'done'
      ? { kind: 'done' }
      : kind === 'snooze'
        ? snooze
          ? { kind: 'snooze', until: snooze }
          : null
        : kind === 'resolve'
          ? { kind: 'resolve', resolution }
          : move === undefined
            ? null
            : { kind: 'move', initiative: move === null ? null : (initiatives.find((i) => i.id === move) ?? null) };

  // ⌘↵ is the keyboard Apply. Selection alone never changes anything.
  useKeyBinding('mod+enter', () => (op && !busy ? onApply(op) : false), { enabled: !!op && !busy, allowInInput: true });

  const label = kind === 'done' ? 'Mark done' : kind === 'snooze' ? 'Snooze' : kind === 'resolve' ? 'Resolve' : 'Move';

  return (
    <div role="region" aria-label="Batch edit" data-testid="bulk-bar" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-selected px-4 py-2.5">
      <span className="text-body font-bold text-fg-heading tabular-nums" aria-live="polite">
        {count} in the batch
      </span>
      <button type="button" onClick={onSelectAll} className="rounded-sm text-caption font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus">
        Add all {total} shown
      </button>
      <span className="h-5 w-px bg-line-strong" aria-hidden />
      <SegmentedToggle
        label="Batch operation"
        size="sm"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'done', label: 'Done' },
          { value: 'snooze', label: 'Snooze' },
          { value: 'resolve', label: 'Resolve' },
          { value: 'move', label: 'Move to initiative' },
        ]}
      />
      {kind === 'snooze' ? (
        <div role="radiogroup" aria-label="Snooze until" className="flex flex-wrap items-center gap-1.5">
          {presets.map((p) => (
            <Choice key={p.id} checked={snooze === p.until} onClick={() => setSnooze(p.until)}>
              {p.label} <span className="text-caption text-muted">{p.hint}</span>
            </Choice>
          ))}
        </div>
      ) : null}
      {kind === 'resolve' ? (
        <div role="radiogroup" aria-label="Resolution" className="flex flex-wrap items-center gap-1.5">
          {BULK_RESOLUTIONS.map((r) => (
            <Choice key={r.value} checked={resolution === r.value} onClick={() => setResolution(r.value)}>
              {r.label}
            </Choice>
          ))}
          <span className="text-caption text-muted">Hand-offs need a person: use ⇧D on one row.</span>
        </div>
      ) : null}
      {kind === 'move' ? (
        <FilterChip
          label="Initiative"
          anyLabel="Choose…"
          value={move === undefined ? null : move === null ? '__none' : move}
          options={[{ value: '__none', label: 'No initiative (remove)' }, ...initiatives.map((i) => ({ value: i.id, label: i.label }))]}
          onChange={(v) => setMove(v === null ? undefined : v === '__none' ? null : v)}
          width={320}
        />
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        <Button variant="quiet" size="sm" onClick={onClear} kbd="escape">
          Clear
        </Button>
        <Button variant="primary" size="sm" kbd="mod+enter" disabled={!op} loading={busy} onClick={() => op && onApply(op)} data-testid="bulk-apply">
          Apply: {label} {count}
        </Button>
      </span>
    </div>
  );
}
