'use client';
/**
 * "It left elsewhere" for the docked panel (docs/UX.md "Live updates"). When the row open in Details leaves its list
 * because of something that happened elsewhere (the worker sent it, another tab applied it, autopilot), the panel does
 * not close or jump: it stays on the item and says so, with Next (the list's neighbour) and Close. A leaf module: the
 * shell's RightPanel reads it, the lists write it.
 */
import { useSyncExternalStore } from 'react';

export interface GoneNote {
  /** "Applied elsewhere", "Removed", "Done elsewhere". */
  title: string;
  body?: string;
  /** Move the panel to the list's neighbour. */
  next?: () => void;
  nextLabel?: string;
}

const notes = new Map<string, GoneNote>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version += 1;
  for (const l of [...listeners]) l();
};

export function markGone(id: string, note: GoneNote): void {
  notes.set(id, note);
  emit();
}

export function clearGone(id: string): void {
  if (notes.delete(id)) emit();
}

export function goneNote(id: string | null | undefined): GoneNote | undefined {
  return id ? notes.get(id) : undefined;
}

export function useGone(id: string | null | undefined): GoneNote | undefined {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  return goneNote(id);
}
