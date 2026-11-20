'use client';
/**
 * The first-launch gate (B-079), mounted once in the root layout around the app frame.
 *
 *   /onboarding        the bare onboarding frame: no sidebar, topbar, panel or chat (their queries need a user)
 *   any other page     the app. `GET /onboarding` runs once per session; `required` (db mode: no user, or one that
 *                      never finished) sends you to /onboarding. Mock mode never requires it.
 *
 * So a fresh database never fires the app's queries (each would fail without a user): when this browser has not
 * seen a set-up database before (flag.ts) and the server is in db mode, the app's queries wait (TanStack's online
 * manager) until the check answers. A browser that knows the app is set up renders at once; the check still runs.
 * If the check itself fails, the app renders (the gate never locks you out).
 */
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, queryKey } from '@/client/api';
import { isOnboardingPath, readOnboarded, writeOnboarded, type OnboardedMode } from './flag';
import { OnboardingFrame } from './OnboardingFrame';
import { OnboardingSkeleton } from './OnboardingSkeleton';

export interface OnboardingGateProps {
  /** The server's data mode at render time (a hint: the check's answer decides). */
  mode: OnboardedMode;
  /** The route's page, shown alone on /onboarding. */
  page: ReactNode;
  /** The app frame with the page inside. */
  children: ReactNode;
}

export function useOnboardingState(enabled = true) {
  return useQuery({
    queryKey: queryKey('getOnboarding'),
    queryFn: ({ signal }) => api('getOnboarding', undefined, { signal }),
    networkMode: 'always',
    staleTime: Infinity,
    retry: 1,
    enabled,
  });
}

export function OnboardingGate({ mode, page, children }: OnboardingGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const onFlow = isOnboardingPath(pathname);
  // Client only, before the app's effects run: hold its queries while a never-seen database is checked.
  useState(() => {
    if (typeof window !== 'undefined' && mode === 'db' && !onFlow && readOnboarded() !== 'db') onlineManager.setOnline(false);
    return true;
  });
  const q = useOnboardingState(!onFlow);
  const required = q.data?.required === true;

  useEffect(() => {
    if (onFlow) return;
    if (q.data && !q.data.required) writeOnboarded(q.data.mode);
    if (q.data?.required) {
      writeOnboarded(null);
      // drop whatever the app queued, so nothing fires without a user, then hand over to the flow
      void qc.cancelQueries({ predicate: (x) => x.queryKey[0] !== 'onboarding' });
      qc.removeQueries({ predicate: (x) => x.queryKey[0] !== 'onboarding' });
      onlineManager.setOnline(true);
      router.replace('/onboarding');
      return;
    }
    if (q.data || q.isError) onlineManager.setOnline(true);
  }, [onFlow, q.data, q.isError, qc, router]);

  if (onFlow) return <OnboardingFrame>{page}</OnboardingFrame>;
  if (required)
    return (
      <OnboardingFrame>
        <OnboardingSkeleton />
      </OnboardingFrame>
    );
  return <>{children}</>;
}
