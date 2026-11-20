'use client';
/**
 * Thin TanStack Query wrappers over the typed client. FE-1 may replace or extend these.
 */
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { JsonRouteKey, RouteClientInput, RouteOutput } from '@/contract';
import { api, queryKey, type ApiError } from './api';

export function useApi<K extends JsonRouteKey>(
  key: K,
  input?: RouteClientInput<K>,
  options?: Omit<UseQueryOptions<RouteOutput<K>, ApiError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<RouteOutput<K>, ApiError>({
    queryKey: queryKey(key, input),
    queryFn: ({ signal }) => api(key, input, { signal }),
    ...options,
  });
}
