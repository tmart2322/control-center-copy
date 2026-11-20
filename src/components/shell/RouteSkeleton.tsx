'use client';
/**
 * Route skeletons: every top-level page's data-free loading wireframe, keyed by pathname, so a tab click shows the
 * destination's layout in the frame the URL changes, before React has rendered the page (or loaded its chunk).
 *
 *   <RouteSkeleton pathname>  what #cc-main shows while a navigation is pending (AppFrame), the client router's
 *                             Suspense fallback while a page's chunk loads (app/(app)/ClientRouter.tsx), and
 *                             what app/loading.tsx renders on a full load (RouteLoading reads the committed pathname)
 *
 * Each skeleton lives beside its page (`*Skeleton.tsx`) and the page renders the same pieces while its queries
 * load, so skeleton → page loading state → data never jumps. Unknown paths (detail pages) get a neutral frame.
 * The wrapper is `display: contents` (pages size against #cc-main) and inert (nothing in a wireframe is clickable).
 */
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { BriefsSkeleton } from '../../../app/briefs/_briefs/BriefsSkeleton';
import { OutboxSkeleton } from '../../../app/outbox/_outbox/OutboxSkeleton';
import { TriageSkeleton } from '../../../app/triage/_triage/TriageSkeleton';
import { WorkSkeleton } from '../../../app/work/_list/WorkSkeleton';
import { AgentsSkeleton, ToolsSkeleton } from '@/components/agents/AgentsSkeleton';
import { AssistantSkeleton } from '@/components/chat/AssistantSkeleton';
import { DealsSkeleton, MissedSkeleton } from '@/components/deals/DealsSkeleton';
import { HealthSkeleton } from '@/components/health/HealthSkeleton';
import { HistorySkeleton } from '@/components/history/HistorySkeleton';
import { HomeSkeleton } from '@/components/home/HomeSkeleton';
import { OnboardingSkeleton } from '@/components/onboarding/OnboardingSkeleton';
import { SettingsSkeleton } from '@/components/settings/SettingsSkeleton';
import { TimeSkeleton } from '@/components/time/TimeSkeleton';
import { TodaySkeleton } from '@/components/today/TodaySkeleton';
import { Skeleton } from '@/ui';
import { normalizePath } from './nav-pending';
import { pageTitleFor } from './titles';

const ROUTE_SKELETONS: Record<string, ComponentType> = {
  '/': HomeSkeleton,
  '/today': TodaySkeleton,
  '/triage': TriageSkeleton,
  '/outbox': OutboxSkeleton,
  '/assistant': AssistantSkeleton,
  '/work': WorkSkeleton,
  '/deals': DealsSkeleton,
  '/deals/missed': MissedSkeleton,
  '/deals/dcs': MissedSkeleton,
  '/briefs': BriefsSkeleton,
  '/agents': AgentsSkeleton,
  '/agents/tools': ToolsSkeleton,
  '/activity': TimeSkeleton,
  '/time': TimeSkeleton,
  '/history': HistorySkeleton,
  '/settings': SettingsSkeleton,
  '/health': HealthSkeleton,
  '/onboarding': OnboardingSkeleton,
};

/** True for the routes with a page-specific skeleton (the top-level tabs and their sub-tabs). */
export function hasRouteSkeleton(pathname: string): boolean {
  return normalizePath(pathname) in ROUTE_SKELETONS;
}

/** A neutral frame for pages without their own skeleton (detail pages, the kit). */
function GenericSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-8 pt-6 pb-4">
      <Skeleton variant="line" className="w-96 max-w-full" />
      <Skeleton variant="card" />
      <Skeleton variant="card" />
    </div>
  );
}

export function RouteSkeleton({ pathname }: { pathname: string }) {
  const path = normalizePath(pathname);
  const Page = ROUTE_SKELETONS[path] ?? GenericSkeleton;
  return (
    <div className="contents" data-route-skeleton={path} aria-busy="true">
      <span role="status" className="sr-only">
        Loading {pageTitleFor(path)}…
      </span>
      <div className="contents" inert>
        <Page />
      </div>
    </div>
  );
}

/** app/**\/loading.tsx: the skeleton of the route being loaded. */
export function RouteLoading() {
  const pathname = usePathname() ?? '/';
  return <RouteSkeleton pathname={pathname} />;
}
