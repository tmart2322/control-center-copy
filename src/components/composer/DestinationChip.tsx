'use client';
/**
 * The destination chip ("Slack · #acme-ext · thread"). It sets the capability profile. Switching shows the
 * lossy-conversion list from `lossyForSwitch` first, and applies only on an explicit "Switch" (⌘⇧C opens it).
 */
import { useEffect, useRef, useState } from 'react';
import type { Destination } from '@/contract';
import type { DocNode } from '@/lib/compose';
import { Button, Icon, StatePill } from '@/ui';
import { cx } from './_bits';
import { destinationParts, lossyLine, type SwitchOption } from './destination';

export interface DestinationChipProps {
  destination: Destination;
  options: SwitchOption[];
  /** Apply the switch: the new destination and the doc with mentions re-resolved for it. */
  onSwitch: (d: Destination, doc: DocNode) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Kit/specimen only: open straight onto the lossy list for this option (index among non-current options). */
  defaultPicked?: number;
}

export function DestinationChip({ destination, options, onSwitch, open, onOpenChange, disabled, compact, defaultPicked }: DestinationChipProps) {
  const root = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<number | null>(defaultPicked ?? null);
  const [cursor, setCursor] = useState(0);
  const parts = destinationParts(destination);
  const others = options.filter((o) => !o.current);

  useEffect(() => {
    if (!open) {
      setPicked(defaultPicked ?? null);
      return;
    }
    setCursor(0);
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onOpenChange, defaultPicked]);

  const chosen = picked != null ? others[picked] : null;

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        data-testid="destination-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        title="Change where this goes · ⌘⇧C"
        className={cx(
          // A neutral label ("Slack · #channel · thread"): where it goes is a fact, not a status color.
          'inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 -mx-2 text-caption text-muted transition-colors',
          'hover:border-line hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent',
        )}
      >
        <Icon name={destination.kind === 'slack' ? 'slack' : 'email'} size="sm" className="text-muted" />
        <span className="truncate">
          <span className="font-bold text-fg">{parts[0]}</span>
          {parts.slice(1).map((p, i) => (
            <span key={i}>
              <span className="px-1 text-faint">·</span>
              {p}
            </span>
          ))}
        </span>
        {!disabled && !compact ? <Icon name="chevrondown" size="xs" className="text-muted" /> : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Switch destination"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              if (chosen) setPicked(null);
              else onOpenChange(false);
            } else if (!chosen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : -1) + others.length) % Math.max(others.length, 1));
            }
          }}
          className="absolute top-full left-0 z-30 mt-1 w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface-raised p-1.5 shadow-pop"
        >
          {!chosen ? (
            <>
              <p className="px-2 pt-1 pb-1.5 text-caption font-bold text-muted">Send to</p>
              <ul className="flex flex-col gap-px">
                <li className="flex items-center gap-2 rounded-md bg-selected px-2 py-1.5 text-body text-fg-heading">
                  <Icon name="check" size="xs" />
                  <span className="truncate">{options.find((o) => o.current)?.label}</span>
                  <span className="ml-auto text-caption text-muted">Current</span>
                </li>
                {others.map((o, i) => (
                  <li key={o.label}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el && i === cursor) el.focus();
                      }}
                      onClick={() => setPicked(i)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                    >
                      <Icon name={o.destination.kind === 'slack' ? 'slack' : 'email'} size="xs" className="text-muted" />
                      <span className="truncate">{o.label}</span>
                      <span className={cx('ml-auto shrink-0 text-caption', o.lossy.length ? 'text-warning-700' : 'text-muted')}>
                        {o.lossy.length ? `${o.lossy.length} formatting change${o.lossy.length > 1 ? 's' : ''}` : 'No changes'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {others.length === 0 ? <p className="px-2 py-2 text-caption text-muted">No other destinations are known for this work.</p> : null}
            </>
          ) : (
            <div className="p-2" data-testid="lossy-list">
              <p className="text-body text-fg">
                Switch to <span className="font-bold">{chosen.label}</span>?
              </p>
              {chosen.lossy.length ? (
                <>
                  <p className="mt-2 text-caption text-muted">This channel can’t render everything in the draft. These change:</p>
                  <ul className="mt-1.5 space-y-1">
                    {chosen.lossy.map((n) => (
                      <li key={`${n.kind}:${n.from}:${n.to}`} className="flex items-start gap-1.5 text-body text-fg">
                        <Icon name="warning" size="xs" className="mt-1 text-warning-700" />
                        {lossyLine(n)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-2 text-caption text-muted">Everything in the draft renders the same there.</p>
              )}
              {chosen.warnings.map((w) => (
                <p key={w.code + w.message} className="mt-2">
                  <StatePill tone="warn" icon="warning" label={w.message} />
                </p>
              ))}
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPicked(null)} data-autofocus>
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  autoFocus
                  onClick={() => {
                    onSwitch(chosen.destination, chosen.doc);
                    onOpenChange(false);
                  }}
                >
                  Switch{chosen.lossy.length ? ' and convert' : ''}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
