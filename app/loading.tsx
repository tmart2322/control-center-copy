// Loading fallback on a full load (a reload or a deep link) and for Next-router navigations to the own routes (the kit):
// the route's data-free skeleton, picked by pathname (src/components/shell/RouteSkeleton.tsx). In-frame tab switches
// never reach it: they are client routes (app/(app)/ClientRouter.tsx), with no server round-trip.
import { RouteLoading } from '@/components/shell/RouteSkeleton';

export default function Loading() {
  return <RouteLoading />;
}
