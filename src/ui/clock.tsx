'use client';
/**
 * App clock. The mock serves its own "now" (CC_MOCK_NOW), so relative times ("start by 10:15",
 * "Saved · 2s ago") use server time = Date.now() + offset. The shell calls `syncServerNow(iso)`
 * when a payload carrying `now` arrives. Times render in settings.profile.timezone.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

let offsetMs = 0;
const listeners = new Set<() => void>();

/** Align the client clock with a server instant (ignores sub-second jitter). */
export function syncServerNow(iso: string | null | undefined) {
  if (!iso) return;
  const next = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(next) || Math.abs(next - offsetMs) < 1500) return;
  offsetMs = next;
  for (const l of listeners) l();
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

function subscribeOffset(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Current server time, re-rendering every `intervalMs` (default 15 s). */
export function useNow(intervalMs = 15_000): Date {
  const offset = useSyncExternalStore(subscribeOffset, () => offsetMs, () => 0);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return new Date(tick + offset);
}

const TimeZoneContext = createContext<string | undefined>(undefined);

export function TimeZoneProvider({ timeZone, children }: { timeZone?: string; children: ReactNode }) {
  return <TimeZoneContext.Provider value={timeZone}>{children}</TimeZoneContext.Provider>;
}

/** The user's IANA zone (settings.profile.timezone), or undefined = browser zone. */
export function useTimeZone(): string | undefined {
  return useContext(TimeZoneContext);
}

/** Real wall-clock ms (no server offset), re-rendering every `intervalMs`. For "Saved · 2s ago". */
export function useWallClock(intervalMs = 5_000): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
