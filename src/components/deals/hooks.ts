'use client';
import { useMemo } from 'react';
import { useApi } from '@/client/hooks';
import { usePersona } from '@/client/persona';
import { useNow, useTimeZone } from '@/ui';
import { dayOf } from './format';
import { dealsFeaturesOf, type DealsFeatures } from './needs';

/** Today's calendar day (YYYY-MM-DD) in the profile timezone, on the app clock (scenario clock in the mock). */
export function useToday(): string {
  const now = useNow(60_000);
  return dayOf(now, useTimeZone());
}

/**
 * The Deals features active for this user's persona (D-55): deal contributions (`dc`), VDP (`vdp`) and the missed-opp
 * sweep (`missed`). While settings load `ready` is false and every flag is off (the gate's own rule: gated words stay
 * hidden until the persona is known); pages that would reflow when a flag turns on keep their skeleton until `ready`.
 */
export function useDealsFeatures(): DealsFeatures & { ready: boolean } {
  const persona = usePersona();
  return useMemo(() => ({ ready: !!persona, ...dealsFeaturesOf(persona) }), [persona]);
}

/**
 * The missed-opp sweep, read only while the persona has it. It is also read while the persona loads, so an SE's
 * sweep starts with the page as it always did; once the persona says it is inactive nothing reads it again.
 */
export function useMissedSweep(f: { ready: boolean; missed: boolean }) {
  return useApi('getMissed', undefined, { enabled: !f.ready || f.missed });
}

/**
 * The VDP connector is broken or behind: VDP link status is stale. Returns the reason, or null when healthy (or when
 * VDP is not active for the persona: then nothing on Deals names VDP).
 */
export function useVdpStale(): string | null {
  const { vdp: active } = useDealsFeatures();
  const health = useApi('getHealth', undefined, { staleTime: 15_000 });
  if (!active) return null;
  const vdp = health.data?.connectors.find((c) => c.source === 'vdp' || c.id === 'vdp');
  if (!vdp || vdp.state === 'ok' || vdp.state === 'paused') return null;
  return vdp.impact ?? `VDP connector: ${vdp.state.replace(/_/g, ' ')}`;
}
