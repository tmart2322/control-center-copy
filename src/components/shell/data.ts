'use client';
/** Chrome data: one place for the queries the header, nav and utility bar share. */
import { useEffect } from 'react';
import type { ConnectorState } from '@/contract';
import { queryKey } from '@/client/api';
import { useApi } from '@/client/hooks';
import { SAFETY_NET_MS, useRefetchAtBoundaries } from '@/client/live';
import { syncServerNow } from '@/ui/clock';
import type { Tone } from '@/ui/tones';

/**
 * Push, not polling (docs/UX.md "Live updates"): Today and Health refresh on their live topics; Today also right after
 * a time it shows comes due (a meeting starts), and both every 5 minutes as a safety net for what only the clock
 * changes (a worker that stopped beating, "in 10 min" labels). These are the app's shared queries: every view that
 * reads getToday or getHealth gets the same behaviour.
 */
export function useChromeData() {
  const today = useApi('getToday', undefined, { refetchInterval: SAFETY_NET_MS });
  useRefetchAtBoundaries(queryKey('getToday'), today.data);
  const health = useApi('getHealth', undefined, { refetchInterval: SAFETY_NET_MS });
  const settings = useApi('getSettings');
  useEffect(() => syncServerNow(today.data?.now), [today.data?.now]);
  return { today, health, settings };
}

/** Worst connector state → health-dot tone (brief 09 §7). */
export function connectorTone(state: ConnectorState | undefined): Tone {
  switch (state) {
    case 'ok':
      return 'ok';
    case 'catching_up':
      return 'brand';
    case 'degraded':
      return 'warn';
    case 'auth_needed':
    case 'error':
      return 'risk';
    default:
      return 'neutral';
  }
}

export const CONNECTOR_STATE_LABEL: Record<ConnectorState, string> = {
  ok: 'Healthy',
  catching_up: 'Catching up',
  degraded: 'Retrying',
  auth_needed: 'Needs re-auth',
  error: 'Broken',
  offline: 'Offline',
  paused: 'Paused',
};
