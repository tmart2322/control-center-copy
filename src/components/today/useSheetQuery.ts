'use client';
/**
 * useApi for side-sheet reads. Optimistic mutations cancel in-flight queries of their topics; a first fetch
 * cancelled that way reverts to "pending" with nothing in flight and would show a skeleton forever. This
 * refetches once it sees that state.
 */
import { useEffect } from 'react';
import type { JsonRouteKey, RouteClientInput } from '@/contract';
import { useApi } from '@/client/hooks';

export function useSheetQuery<K extends JsonRouteKey>(key: K, input?: RouteClientInput<K>, opts?: { enabled?: boolean }) {
  const q = useApi(key, input, opts);
  const stuck = (opts?.enabled ?? true) && q.status === 'pending' && q.fetchStatus === 'idle';
  const { refetch } = q;
  useEffect(() => {
    if (stuck) void refetch();
  }, [stuck, refetch]);
  return q;
}
