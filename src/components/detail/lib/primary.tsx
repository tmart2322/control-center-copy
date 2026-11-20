'use client';
/**
 * The detail's ONE filled action (DESIGN-V2 principle 4: quiet actions, loud selection).
 *
 * In the sheet and page variants each NBA body renders its own primary in place (Send, Start in Claude,
 * Run …). In the docked panel the filled button moves to the sticky footer: the body *publishes* its
 * primary here instead of drawing it, and the footer (usePrimaryClaim) renders the latest claim. A body
 * that unmounts withdraws its claim, so the footer falls back to the item's own verb (Done, Accept, …).
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

export interface PrimarySpec {
  label: string;
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Why it's disabled ("Write something first"). */
  hint?: string | null;
  kbd?: string;
  /** Replaces the button while the send border's undo window runs (the Undo sits where you clicked). */
  countdown?: { deadline: number; durationMs: number; label: string; dryRun: boolean; onUndo: () => void } | null;
  /** Shown instead of the button while dispatching ("Rendering…"). */
  busyLabel?: string | null;
  run: () => void;
}

interface Slot {
  set(owner: string, spec: PrimarySpec | null): void;
}

const SlotContext = createContext<Slot | null>(null);
const ClaimContext = createContext<PrimarySpec | null>(null);

/** Hosts the slot (the panel variant). Children publish with usePublishPrimary; the footer reads usePrimaryClaim. */
export function PrimarySlotProvider({ children }: { children: ReactNode }) {
  const [claim, setClaim] = useState<{ owner: string; spec: PrimarySpec } | null>(null);
  const set = useCallback((owner: string, spec: PrimarySpec | null) => {
    setClaim((prev) => (spec ? { owner, spec } : prev?.owner === owner ? null : prev));
  }, []);
  const slot = useMemo<Slot>(() => ({ set }), [set]);
  return (
    <SlotContext.Provider value={slot}>
      <ClaimContext.Provider value={claim?.spec ?? null}>{children}</ClaimContext.Provider>
    </SlotContext.Provider>
  );
}

/** The footer's view of the current claim (null: nothing published, use the item's own verb). */
export function usePrimaryClaim(): PrimarySpec | null {
  return useContext(ClaimContext);
}

/**
 * Publish this body's primary to the footer (no-op outside the panel). `spec.run` may change every
 * render; only the visible fields re-publish. Returns true when the primary is external (don't draw it).
 */
export function usePublishPrimary(spec: PrimarySpec | null): boolean {
  const slot = useContext(SlotContext);
  const owner = useId();
  const latest = useRef(spec);
  latest.current = spec;
  const cd = spec?.countdown;
  const key = spec ? JSON.stringify([spec.label, spec.icon, !!spec.disabled, !!spec.loading, spec.hint ?? null, spec.kbd ?? null, spec.busyLabel ?? null, cd ? [cd.deadline, cd.label, cd.dryRun] : null]) : null;
  useEffect(() => {
    if (!slot) return;
    const s = latest.current;
    slot.set(
      owner,
      s
        ? {
            ...s,
            run: () => latest.current?.run(),
            countdown: s.countdown ? { ...s.countdown, onUndo: () => latest.current?.countdown?.onUndo() } : null,
          }
        : null,
    );
  }, [slot, owner, key]);
  useEffect(() => () => slot?.set(owner, null), [slot, owner]);
  return !!slot;
}
