'use client';
/**
 * The domain clock: the app's "now" (mock scenario clock or real time) and the profile timezone.
 * Wrap a page once: <DomainClock now={today.now} tz={settings.profile.timezone}>. Components read it with
 * useClock(); explicit `now` props win.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

type ClockValue = { now: string; tz?: string };
const Ctx = createContext<ClockValue | null>(null);

export function DomainClock({ now, tz, children }: { now: string; tz?: string; children: ReactNode }) {
  return <Ctx.Provider value={{ now, tz }}>{children}</Ctx.Provider>;
}

export function useClock(override?: { now?: string; tz?: string }): ClockValue {
  const ctx = useContext(Ctx);
  // Fallback when no provider: freeze "now" at first render so re-renders don't drift.
  const [fallback] = useState(() => new Date().toISOString());
  return { now: override?.now ?? ctx?.now ?? fallback, tz: override?.tz ?? ctx?.tz };
}
